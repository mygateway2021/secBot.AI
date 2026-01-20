import os
import json
from pathlib import Path
from uuid import uuid4
import numpy as np
from datetime import datetime
from fastapi import APIRouter, WebSocket, UploadFile, File, Response, HTTPException
from pydantic import BaseModel
from starlette.responses import JSONResponse
from starlette.websockets import WebSocketDisconnect
from loguru import logger
from .service_context import ServiceContext
from .websocket_handler import WebSocketHandler
from .proxy_handler import ProxyHandler
from .config_manager.utils import (
    load_text_file_with_guess_encoding,
    read_yaml,
    validate_config,
)
import yaml


def init_client_ws_route(default_context_cache: ServiceContext) -> APIRouter:
    """
    Create and return API routes for handling the `/client-ws` WebSocket connections.

    Args:
        default_context_cache: Default service context cache for new sessions.

    Returns:
        APIRouter: Configured router with WebSocket endpoint.
    """

    router = APIRouter()
    ws_handler = WebSocketHandler(default_context_cache)

    @router.websocket("/client-ws")
    async def websocket_endpoint(websocket: WebSocket):
        """WebSocket endpoint for client connections"""
        await websocket.accept()
        client_uid = str(uuid4())

        try:
            await ws_handler.handle_new_connection(websocket, client_uid)
            await ws_handler.handle_websocket_communication(websocket, client_uid)
        except WebSocketDisconnect:
            await ws_handler.handle_disconnect(client_uid)
        except Exception as e:
            logger.error(f"Error in WebSocket connection: {e}")
            await ws_handler.handle_disconnect(client_uid)
            raise

    return router


def init_proxy_route(server_url: str) -> APIRouter:
    """
    Create and return API routes for handling proxy connections.

    Args:
        server_url: The WebSocket URL of the actual server

    Returns:
        APIRouter: Configured router with proxy WebSocket endpoint
    """
    router = APIRouter()
    proxy_handler = ProxyHandler(server_url)

    @router.websocket("/proxy-ws")
    async def proxy_endpoint(websocket: WebSocket):
        """WebSocket endpoint for proxy connections"""
        try:
            await proxy_handler.handle_client_connection(websocket)
        except Exception as e:
            logger.error(f"Error in proxy connection: {e}")
            raise

    return router


def init_webtool_routes(default_context_cache: ServiceContext) -> APIRouter:
    """
    Create and return API routes for handling web tool interactions.

    Args:
        default_context_cache: Default service context cache for new sessions.

    Returns:
        APIRouter: Configured router with WebSocket endpoint.
    """

    router = APIRouter()

    class CharacterConfigUpdate(BaseModel):
        """Request body for updating a character config YAML file."""

        content: str

    def _deep_merge_dicts(base: dict, overrides: dict) -> dict:
        """Recursively merge two dictionaries.

        Values from `overrides` take precedence. Nested dictionaries are merged.

        Args:
            base: Base dictionary.
            overrides: Dictionary with overriding values.

        Returns:
            A new dictionary with merged values.
        """

        result = dict(base)
        for key, value in overrides.items():
            if (
                key in result
                and isinstance(result[key], dict)
                and isinstance(value, dict)
            ):
                result[key] = _deep_merge_dicts(result[key], value)
            else:
                result[key] = value
        return result

    def _resolve_character_config_path(filename: str) -> Path:
        """Resolve a character config filename to a safe on-disk path.

        Args:
            filename: The config filename (e.g. 'conf.yaml' or 'my_char.yaml').

        Returns:
            A Path pointing to the resolved config file.

        Raises:
            HTTPException: If the filename is invalid or outside the allowed directories.
        """

        if not filename:
            raise HTTPException(status_code=400, detail="Missing filename")

        # Disallow path traversal / nested paths
        if Path(filename).name != filename:
            raise HTTPException(status_code=400, detail="Invalid filename")

        if filename == "conf.yaml":
            path = Path("conf.yaml")
        else:
            if not filename.endswith(".yaml"):
                raise HTTPException(
                    status_code=400, detail="Only .yaml files are allowed"
                )

            config_alts_dir = default_context_cache.config.system_config.config_alts_dir
            base_dir = Path(config_alts_dir).resolve()
            path = (base_dir / filename).resolve()

            # Ensure resolved path is within config_alts_dir
            if base_dir not in path.parents and path != base_dir:
                raise HTTPException(status_code=400, detail="Invalid filename")

        if not path.exists() or not path.is_file():
            raise HTTPException(status_code=404, detail="Config file not found")

        return path

    @router.get("/live2d-models/info")
    async def get_live2d_folder_info():
        """Get information about available Live2D models"""
        live2d_dir = "live2d-models"
        if not os.path.exists(live2d_dir):
            return JSONResponse(
                {"error": "Live2D models directory not found"}, status_code=404
            )

        valid_characters = []
        supported_extensions = [".png", ".jpg", ".jpeg"]

        for entry in os.scandir(live2d_dir):
            if entry.is_dir():
                folder_name = entry.name.replace("\\", "/")
                model3_file = os.path.join(
                    live2d_dir, folder_name, f"{folder_name}.model3.json"
                ).replace("\\", "/")

                if os.path.isfile(model3_file):
                    # Find avatar file if it exists
                    avatar_file = None
                    for ext in supported_extensions:
                        avatar_path = os.path.join(
                            live2d_dir, folder_name, f"{folder_name}{ext}"
                        )
                        if os.path.isfile(avatar_path):
                            avatar_file = avatar_path.replace("\\", "/")
                            break

                    valid_characters.append(
                        {
                            "name": folder_name,
                            "avatar": avatar_file,
                            "model_path": model3_file,
                        }
                    )
        return JSONResponse(
            {
                "type": "live2d-models/info",
                "count": len(valid_characters),
                "characters": valid_characters,
            }
        )

    @router.post("/asr")
    async def transcribe_audio(file: UploadFile = File(...)):
        """
        Endpoint for transcribing audio using the ASR engine
        """
        logger.info(f"Received audio file for transcription: {file.filename}")

        try:
            contents = await file.read()

            # Validate minimum file size
            if len(contents) < 44:  # Minimum WAV header size
                raise ValueError("Invalid WAV file: File too small")

            # Decode the WAV header and get actual audio data
            wav_header_size = 44  # Standard WAV header size
            audio_data = contents[wav_header_size:]

            # Validate audio data size
            if len(audio_data) % 2 != 0:
                raise ValueError("Invalid audio data: Buffer size must be even")

            # Convert to 16-bit PCM samples to float32
            try:
                audio_array = (
                    np.frombuffer(audio_data, dtype=np.int16).astype(np.float32)
                    / 32768.0
                )
            except ValueError as e:
                raise ValueError(
                    f"Audio format error: {str(e)}. Please ensure the file is 16-bit PCM WAV format."
                )

            # Validate audio data
            if len(audio_array) == 0:
                raise ValueError("Empty audio data")

            text = await default_context_cache.asr_engine.async_transcribe_np(
                audio_array
            )
            logger.info(f"Transcription result: {text}")
            return {"text": text}

        except ValueError as e:
            logger.error(f"Audio format error: {e}")
            return Response(
                content=json.dumps({"error": str(e)}),
                status_code=400,
                media_type="application/json",
            )
        except Exception as e:
            logger.error(f"Error during transcription: {e}")
            return Response(
                content=json.dumps(
                    {"error": "Internal server error during transcription"}
                ),
                status_code=500,
                media_type="application/json",
            )

    @router.websocket("/tts-ws")
    async def tts_endpoint(websocket: WebSocket):
        """WebSocket endpoint for TTS generation"""
        await websocket.accept()
        logger.info("TTS WebSocket connection established")

        try:
            while True:
                data = await websocket.receive_json()
                text = data.get("text")
                if not text:
                    continue

                logger.info(f"Received text for TTS: {text}")

                # Split text into sentences
                sentences = [s.strip() for s in text.split(".") if s.strip()]

                try:
                    # Generate and send audio for each sentence
                    for sentence in sentences:
                        sentence = sentence + "."  # Add back the period
                        file_name = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{str(uuid4())[:8]}"
                        audio_path = (
                            await default_context_cache.tts_engine.async_generate_audio(
                                text=sentence, file_name_no_ext=file_name
                            )
                        )
                        logger.info(
                            f"Generated audio for sentence: {sentence} at: {audio_path}"
                        )

                        await websocket.send_json(
                            {
                                "status": "partial",
                                "audioPath": audio_path,
                                "text": sentence,
                            }
                        )

                    # Send completion signal
                    await websocket.send_json({"status": "complete"})

                except Exception as e:
                    logger.error(f"Error generating TTS: {e}")
                    await websocket.send_json({"status": "error", "message": str(e)})

        except WebSocketDisconnect:
            logger.info("TTS WebSocket client disconnected")
        except Exception as e:
            logger.error(f"Error in TTS WebSocket connection: {e}")
            await websocket.close()

    @router.get("/character-configs/{filename}")
    async def get_character_config_yaml(filename: str):
        """Return the raw YAML text for a character configuration file."""
        path = _resolve_character_config_path(filename)
        content = load_text_file_with_guess_encoding(str(path))
        if content is None:
            raise HTTPException(status_code=500, detail="Failed to read config file")
        return JSONResponse({"filename": filename, "content": content})

    @router.put("/character-configs/{filename}")
    async def update_character_config_yaml(filename: str, body: CharacterConfigUpdate):
        """Update a character configuration YAML file after validating syntax and schema."""
        path = _resolve_character_config_path(filename)

        try:
            parsed = yaml.safe_load(body.content)
        except yaml.YAMLError as e:
            raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")

        if not isinstance(parsed, dict):
            raise HTTPException(
                status_code=400, detail="YAML root must be a mapping/object"
            )

        # NOTE:
        # - conf.yaml is the full application config and must fully validate.
        # - character preset YAMLs in `characters/` are intentionally partial overrides
        #   (Options unset remain unchanged when switching character).
        #   Validate them by merging with base conf.yaml's character_config.
        if filename == "conf.yaml":
            config_to_validate = parsed
        else:
            base_config = read_yaml("conf.yaml")
            if not isinstance(base_config, dict):
                raise HTTPException(
                    status_code=500,
                    detail="Failed to load base conf.yaml for validation",
                )

            alt_character_config = parsed.get("character_config")
            if not isinstance(alt_character_config, dict):
                raise HTTPException(
                    status_code=400,
                    detail="character_config must be a mapping/object",
                )

            base_character_config = base_config.get("character_config")
            if not isinstance(base_character_config, dict):
                raise HTTPException(
                    status_code=500,
                    detail="Base conf.yaml is missing character_config",
                )

            merged_character_config = _deep_merge_dicts(
                base_character_config, alt_character_config
            )

            # Validate using the merged full character_config, but keep the stored
            # preset YAML as the user's lightweight overrides.
            #
            # Important: only include optional top-level sections when they are
            # present as mappings. Passing explicit `None` would override Pydantic
            # defaults and fail validation (e.g. daily_life).
            config_to_validate: dict = {
                "character_config": merged_character_config,
            }

            system_config = base_config.get("system_config")
            if isinstance(system_config, dict):
                config_to_validate["system_config"] = system_config

            live_config = base_config.get("live_config")
            if isinstance(live_config, dict):
                config_to_validate["live_config"] = live_config

            daily_life = base_config.get("daily_life")
            if isinstance(daily_life, dict):
                config_to_validate["daily_life"] = daily_life

        try:
            validate_config(config_to_validate)
        except Exception as e:
            # Return a readable error to the UI; avoid leaking stack traces.
            raise HTTPException(
                status_code=400, detail=f"Config validation failed: {e}"
            )

        try:
            path.write_text(body.content, encoding="utf-8")
        except Exception as e:
            raise HTTPException(
                status_code=500, detail=f"Failed to write config file: {e}"
            )

        return JSONResponse({"ok": True, "filename": filename})

    return router
