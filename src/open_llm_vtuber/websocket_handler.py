from typing import Dict, List, Optional, Callable, TypedDict
from fastapi import WebSocket, WebSocketDisconnect
import asyncio
import json
from enum import Enum
import numpy as np
from loguru import logger

from .service_context import ServiceContext
from .chat_group import (
    ChatGroupManager,
    handle_group_operation,
    handle_client_disconnect,
    broadcast_to_group,
)
from .message_handler import message_handler
from .utils.stream_audio import prepare_audio_payload
from .chat_history_manager import (
    create_new_history,
    get_history,
    delete_history,
    get_history_list,
)
from .config_manager.utils import scan_config_alts_directory, scan_bg_directory
from .conversations.conversation_handler import (
    handle_conversation_trigger,
    handle_group_interrupt,
    handle_individual_interrupt,
)
from .conversations.conversation_utils import create_batch_input
from .agent.output_types import SentenceOutput, AudioOutput
from .diary_manager import (
    create_diary_entry,
    delete_diary_entry,
    list_diary_entries,
    update_diary_entry,
)


class MessageType(Enum):
    """Enum for WebSocket message types"""

    GROUP = ["add-client-to-group", "remove-client-from-group"]
    HISTORY = [
        "fetch-history-list",
        "fetch-and-set-history",
        "create-new-history",
        "delete-history",
    ]
    DIARY = [
        "fetch-diary-list",
        "generate-diary",
        "delete-diary",
        "update-diary",
    ]
    CONVERSATION = ["mic-audio-end", "text-input", "ai-speak-signal"]
    CONFIG = ["fetch-configs", "switch-config"]
    CONTROL = ["interrupt-signal", "audio-play-start"]
    DATA = ["mic-audio-data"]


class WSMessage(TypedDict, total=False):
    """Type definition for WebSocket messages"""

    type: str
    action: Optional[str]
    text: Optional[str]
    audio: Optional[List[float]]
    images: Optional[List[str]]
    history_uid: Optional[str]
    history_uids: Optional[List[str]]
    diary_uid: Optional[str]
    conf_uid: Optional[str]
    content: Optional[str]
    file: Optional[str]
    display_text: Optional[dict]
    daily_schedule: Optional[str]


class WebSocketHandler:
    """Handles WebSocket connections and message routing"""

    def __init__(self, default_context_cache: ServiceContext):
        """Initialize the WebSocket handler with default context"""
        self.client_connections: Dict[str, WebSocket] = {}
        self.client_contexts: Dict[str, ServiceContext] = {}
        self.chat_group_manager = ChatGroupManager()
        self.current_conversation_tasks: Dict[str, Optional[asyncio.Task]] = {}
        self.default_context_cache = default_context_cache
        self.received_data_buffers: Dict[str, np.ndarray] = {}

        # Message handlers mapping
        self._message_handlers = self._init_message_handlers()

    def _init_message_handlers(self) -> Dict[str, Callable]:
        """Initialize message type to handler mapping"""
        return {
            "add-client-to-group": self._handle_group_operation,
            "remove-client-from-group": self._handle_group_operation,
            "request-group-info": self._handle_group_info,
            "fetch-history-list": self._handle_history_list_request,
            "fetch-and-set-history": self._handle_fetch_history,
            "create-new-history": self._handle_create_history,
            "delete-history": self._handle_delete_history,
            "fetch-diary-list": self._handle_diary_list_request,
            "generate-diary": self._handle_generate_diary,
            "delete-diary": self._handle_delete_diary,
            "update-diary": self._handle_update_diary,
            "interrupt-signal": self._handle_interrupt,
            "mic-audio-data": self._handle_audio_data,
            "mic-audio-end": self._handle_conversation_trigger,
            "raw-audio-data": self._handle_raw_audio_data,
            "text-input": self._handle_conversation_trigger,
            "ai-speak-signal": self._handle_conversation_trigger,
            "fetch-configs": self._handle_fetch_configs,
            "switch-config": self._handle_config_switch,
            "fetch-backgrounds": self._handle_fetch_backgrounds,
            "audio-play-start": self._handle_audio_play_start,
            "request-init-config": self._handle_init_config_request,
            "heartbeat": self._handle_heartbeat,
        }

    async def handle_new_connection(
        self, websocket: WebSocket, client_uid: str
    ) -> None:
        """
        Handle new WebSocket connection setup

        Args:
            websocket: The WebSocket connection
            client_uid: Unique identifier for the client

        Raises:
            Exception: If initialization fails
        """
        try:
            session_service_context = await self._init_service_context(
                websocket.send_text, client_uid
            )

            await self._store_client_data(
                websocket, client_uid, session_service_context
            )

            await self._send_initial_messages(
                websocket, client_uid, session_service_context
            )

            logger.info(f"Connection established for client {client_uid}")

        except Exception as e:
            logger.error(
                f"Failed to initialize connection for client {client_uid}: {e}"
            )
            await self._cleanup_failed_connection(client_uid)
            raise

    async def _store_client_data(
        self,
        websocket: WebSocket,
        client_uid: str,
        session_service_context: ServiceContext,
    ):
        """Store client data and initialize group status"""
        self.client_connections[client_uid] = websocket
        self.client_contexts[client_uid] = session_service_context
        self.received_data_buffers[client_uid] = np.array([])

        self.chat_group_manager.client_group_map[client_uid] = ""
        await self.send_group_update(websocket, client_uid)

    async def _send_initial_messages(
        self,
        websocket: WebSocket,
        client_uid: str,
        session_service_context: ServiceContext,
    ):
        """Send initial connection messages to the client"""
        await websocket.send_text(
            json.dumps({"type": "full-text", "text": "Connection established"})
        )

        await websocket.send_text(
            json.dumps(
                {
                    "type": "set-model-and-conf",
                    "model_info": session_service_context.live2d_model.model_info,
                    "conf_name": session_service_context.character_config.conf_name,
                    "conf_uid": session_service_context.character_config.conf_uid,
                    "client_uid": client_uid,
                }
            )
        )

        # Send initial group status
        await self.send_group_update(websocket, client_uid)

        # Start microphone
        await websocket.send_text(json.dumps({"type": "control", "text": "start-mic"}))

    async def _init_service_context(
        self, send_text: Callable, client_uid: str
    ) -> ServiceContext:
        """Initialize service context for a new session by cloning the default context"""
        session_service_context = ServiceContext()
        await session_service_context.load_cache(
            config=self.default_context_cache.config.model_copy(deep=True),
            system_config=self.default_context_cache.system_config.model_copy(
                deep=True
            ),
            character_config=self.default_context_cache.character_config.model_copy(
                deep=True
            ),
            live2d_model=self.default_context_cache.live2d_model,
            asr_engine=self.default_context_cache.asr_engine,
            tts_engine=self.default_context_cache.tts_engine,
            vad_engine=self.default_context_cache.vad_engine,
            agent_engine=self.default_context_cache.agent_engine,
            translate_engine=self.default_context_cache.translate_engine,
            mcp_server_registery=self.default_context_cache.mcp_server_registery,
            tool_adapter=self.default_context_cache.tool_adapter,
            send_text=send_text,
            client_uid=client_uid,
        )
        return session_service_context

    async def handle_websocket_communication(
        self, websocket: WebSocket, client_uid: str
    ) -> None:
        """
        Handle ongoing WebSocket communication

        Args:
            websocket: The WebSocket connection
            client_uid: Unique identifier for the client
        """
        try:
            while True:
                try:
                    data = await websocket.receive_json()
                    message_handler.handle_message(client_uid, data)
                    await self._route_message(websocket, client_uid, data)
                except WebSocketDisconnect:
                    raise
                except json.JSONDecodeError:
                    logger.error("Invalid JSON received")
                    continue
                except Exception as e:
                    logger.error(f"Error processing message: {e}")
                    await websocket.send_text(
                        json.dumps({"type": "error", "message": str(e)})
                    )
                    continue

        except WebSocketDisconnect:
            logger.info(f"Client {client_uid} disconnected")
            raise
        except Exception as e:
            logger.error(f"Fatal error in WebSocket communication: {e}")
            raise

    async def _route_message(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """
        Route incoming message to appropriate handler

        Args:
            websocket: The WebSocket connection
            client_uid: Client identifier
            data: Message data
        """
        msg_type = data.get("type")
        if not msg_type:
            logger.warning("Message received without type")
            return

        handler = self._message_handlers.get(msg_type)
        if handler:
            await handler(websocket, client_uid, data)
        else:
            if msg_type != "frontend-playback-complete":
                logger.warning(f"Unknown message type: {msg_type}")

    async def _handle_group_operation(
        self, websocket: WebSocket, client_uid: str, data: dict
    ) -> None:
        """Handle group-related operations"""
        operation = data.get("type")
        target_uid = data.get(
            "invitee_uid" if operation == "add-client-to-group" else "target_uid"
        )

        await handle_group_operation(
            operation=operation,
            client_uid=client_uid,
            target_uid=target_uid,
            chat_group_manager=self.chat_group_manager,
            client_connections=self.client_connections,
            send_group_update=self.send_group_update,
        )

    async def handle_disconnect(self, client_uid: str) -> None:
        """Handle client disconnection"""
        group = self.chat_group_manager.get_client_group(client_uid)
        if group:
            await handle_group_interrupt(
                group_id=group.group_id,
                heard_response="",
                current_conversation_tasks=self.current_conversation_tasks,
                chat_group_manager=self.chat_group_manager,
                client_contexts=self.client_contexts,
                broadcast_to_group=self.broadcast_to_group,
            )

        await handle_client_disconnect(
            client_uid=client_uid,
            chat_group_manager=self.chat_group_manager,
            client_connections=self.client_connections,
            send_group_update=self.send_group_update,
        )

        # Clean up other client data
        self.client_connections.pop(client_uid, None)
        self.client_contexts.pop(client_uid, None)
        self.received_data_buffers.pop(client_uid, None)
        if client_uid in self.current_conversation_tasks:
            task = self.current_conversation_tasks[client_uid]
            if task and not task.done():
                task.cancel()
            self.current_conversation_tasks.pop(client_uid, None)

        # Call context close to clean up resources (e.g., MCPClient)
        context = self.client_contexts.get(client_uid)
        if context:
            await context.close()

        logger.info(f"Client {client_uid} disconnected")
        message_handler.cleanup_client(client_uid)

    async def _cleanup_failed_connection(self, client_uid: str) -> None:
        """Clean up failed connection data"""
        self.client_connections.pop(client_uid, None)
        self.client_contexts.pop(client_uid, None)
        self.received_data_buffers.pop(client_uid, None)
        self.chat_group_manager.client_group_map.pop(client_uid, None)

        if client_uid in self.current_conversation_tasks:
            task = self.current_conversation_tasks[client_uid]
            if task and not task.done():
                task.cancel()
            self.current_conversation_tasks.pop(client_uid, None)

        message_handler.cleanup_client(client_uid)

    async def broadcast_to_group(
        self, group_members: list[str], message: dict, exclude_uid: str = None
    ) -> None:
        """Broadcasts a message to group members"""
        await broadcast_to_group(
            group_members=group_members,
            message=message,
            client_connections=self.client_connections,
            exclude_uid=exclude_uid,
        )

    async def send_group_update(self, websocket: WebSocket, client_uid: str):
        """Sends group information to a client"""
        group = self.chat_group_manager.get_client_group(client_uid)
        if group:
            current_members = self.chat_group_manager.get_group_members(client_uid)
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "group-update",
                        "members": current_members,
                        "is_owner": group.owner_uid == client_uid,
                    }
                )
            )
        else:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "group-update",
                        "members": [],
                        "is_owner": False,
                    }
                )
            )

    async def _handle_interrupt(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle conversation interruption"""
        heard_response = data.get("text", "")
        context = self.client_contexts[client_uid]
        group = self.chat_group_manager.get_client_group(client_uid)

        if group and len(group.members) > 1:
            await handle_group_interrupt(
                group_id=group.group_id,
                heard_response=heard_response,
                current_conversation_tasks=self.current_conversation_tasks,
                chat_group_manager=self.chat_group_manager,
                client_contexts=self.client_contexts,
                broadcast_to_group=self.broadcast_to_group,
            )
        else:
            await handle_individual_interrupt(
                client_uid=client_uid,
                current_conversation_tasks=self.current_conversation_tasks,
                context=context,
                heard_response=heard_response,
            )

    async def _handle_history_list_request(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle request for chat history list"""
        context = self.client_contexts[client_uid]
        histories = get_history_list(context.character_config.conf_uid)
        await websocket.send_text(
            json.dumps({"type": "history-list", "histories": histories})
        )

    async def _handle_diary_list_request(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle request for diary list."""

        context = self.client_contexts[client_uid]
        requested_conf_uid = data.get("conf_uid")
        conf_uid = context.character_config.conf_uid

        if requested_conf_uid and str(requested_conf_uid) != conf_uid:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": "Character preset mismatch. Please switch character preset and try again.",
                    }
                )
            )
            return

        diaries = [d for d in list_diary_entries() if d.get("conf_uid") == conf_uid]
        await websocket.send_text(
            json.dumps({"type": "diary-list", "diaries": diaries})
        )

    async def _handle_generate_diary(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Generate a concise diary from selected chat histories."""

        history_uids = data.get("history_uids") or []
        if not isinstance(history_uids, list) or not history_uids:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": "Missing history_uids for diary generation",
                    }
                )
            )
            return

        # Basic safety limits
        history_uids = [str(uid) for uid in history_uids[:20] if uid]

        context = self.client_contexts[client_uid]
        requested_conf_uid = data.get("conf_uid")
        conf_uid = context.character_config.conf_uid
        character_name = context.character_config.character_name
        human_name = context.character_config.human_name

        if requested_conf_uid and str(requested_conf_uid) != conf_uid:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": "Character preset mismatch. Please switch character preset and try again.",
                    }
                )
            )
            return

        # Collect chat logs
        parts: list[str] = []
        for uid in history_uids:
            msgs = [
                msg
                for msg in get_history(conf_uid, uid)
                if msg.get("role") in {"human", "ai"}
            ]
            if not msgs:
                continue

            # Keep the prompt size bounded
            msgs = msgs[-60:]
            lines = []
            for m in msgs:
                role = "User" if m.get("role") == "human" else character_name
                content = (m.get("content") or "").strip()
                if not content:
                    continue
                lines.append(f"[{m.get('timestamp', '')}] {role}: {content}")

            if lines:
                parts.append(
                    "\n".join(
                        [
                            f"=== Chat History {uid} ===",
                            *lines,
                        ]
                    )
                )

        if not parts:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": "Selected histories are empty",
                    }
                )
            )
            return

        joined_history = "\n\n".join(parts)

        configured_diary_prompt = (
            getattr(context.character_config, "diary_prompt", "") or ""
        ).strip()
        if configured_diary_prompt:
            # Support simple variable replacement without risking .format() crashes.
            base_prompt = configured_diary_prompt.replace(
                "{{character_name}}", character_name
            ).replace("{{human_name}}", human_name)
        else:
            base_prompt = (
                f"Write a concise personal diary entry as {character_name}.\n"
                "This diary is written by the character herself (first-person 'I'), "
                "reflecting on her interaction with the user.\n"
                "IMPORTANT: Use your persona/system prompt and the relationship "
                f"between you ({character_name}) and the user ({human_name}) to frame the tone and wording.\n"
                "Requirements:\n"
                "- Keep it concise (around 150-300 Chinese characters)\n"
                "- First-person voice as the character\n"
                "- Summarize key events and feelings toward the user\n"
            )

        safety_suffix = (
            "Constraints (always follow):\n"
            "- Use ONLY the facts explicitly present in the provided chat logs; do not use any other memories, other chat histories, tools, web browsing, or external info\n"
            "- If something is not mentioned in the provided chat logs, omit it (do not invent)\n"
            "- No meta commentary, no system prompt disclosure\n"
            "- Do NOT call tools or browse the web\n"
        )

        prompt = (
            f"{base_prompt.strip()}\n\n"
            f"{safety_suffix}\n"
            "Chat logs (between you and the user):\n"
            f"{joined_history}\n"
        )

        batch_input = create_batch_input(
            input_text=prompt,
            images=None,
            from_name=context.character_config.human_name,
            metadata={
                "skip_memory": True,
                "skip_history": True,
                "diary_generation": True,
                "use_memory": False,
                "disable_tools": True,
            },
        )

        full_text = ""
        try:
            agent_output_stream = context.agent_engine.chat(batch_input)

            async for output_item in agent_output_stream:
                if isinstance(output_item, dict):
                    # Ignore tool-call-status events for diary generation.
                    continue
                if isinstance(output_item, SentenceOutput):
                    full_text += output_item.display_text.text
                    continue
                if isinstance(output_item, AudioOutput):
                    full_text += output_item.transcript
                    continue
                if isinstance(output_item, str):
                    full_text += output_item
                    continue

                logger.debug(f"Unexpected diary output type: {type(output_item)}")

        except Exception as exc:
            logger.error(f"Diary generation failed: {exc}")
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": f"Diary generation failed: {exc}",
                    }
                )
            )
            return

        diary_text = full_text.strip()
        if not diary_text:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": "Diary generation returned empty text",
                    }
                )
            )
            return

        entry = create_diary_entry(
            conf_uid=conf_uid,
            character_name=character_name,
            source_history_uids=history_uids,
            content=diary_text,
        )

        await websocket.send_text(
            json.dumps({"type": "diary-generated", "diary": entry})
        )

        return

    async def _handle_delete_diary(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle deletion of a diary entry."""

        diary_uid = data.get("diary_uid")
        conf_uid = data.get("conf_uid")
        if not diary_uid or not conf_uid:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": "Missing diary_uid/conf_uid for diary deletion",
                    }
                )
            )
            return

        success = delete_diary_entry(conf_uid=str(conf_uid), diary_uid=str(diary_uid))
        await websocket.send_text(
            json.dumps(
                {
                    "type": "diary-deleted",
                    "success": success,
                    "diary_uid": str(diary_uid),
                    "conf_uid": str(conf_uid),
                }
            )
        )

    async def _handle_update_diary(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle editing of a diary entry."""

        diary_uid = data.get("diary_uid")
        conf_uid = data.get("conf_uid")
        content = data.get("content")

        if not diary_uid or not conf_uid or content is None:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": "Missing diary_uid/conf_uid/content for diary update",
                    }
                )
            )
            return

        updated = update_diary_entry(
            conf_uid=str(conf_uid),
            diary_uid=str(diary_uid),
            new_content=str(content),
        )

        if not updated:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": "Failed to update diary entry",
                    }
                )
            )
            return

        await websocket.send_text(
            json.dumps(
                {
                    "type": "diary-updated",
                    "diary": updated,
                }
            )
        )

    async def _handle_fetch_history(
        self, websocket: WebSocket, client_uid: str, data: dict
    ):
        """Handle fetching and setting specific chat history"""
        history_uid = data.get("history_uid")
        if not history_uid:
            return

        context = self.client_contexts[client_uid]
        # Update history_uid in service context
        context.history_uid = history_uid
        context.agent_engine.set_memory_from_history(
            conf_uid=context.character_config.conf_uid,
            history_uid=history_uid,
        )

        messages = [
            msg
            for msg in get_history(
                context.character_config.conf_uid,
                history_uid,
            )
            if msg["role"] != "system"
        ]
        await websocket.send_text(
            json.dumps({"type": "history-data", "messages": messages})
        )

    async def _handle_create_history(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle creation of new chat history"""
        context = self.client_contexts[client_uid]
        history_uid = create_new_history(context.character_config.conf_uid)
        if history_uid:
            context.history_uid = history_uid
            context.agent_engine.set_memory_from_history(
                conf_uid=context.character_config.conf_uid,
                history_uid=history_uid,
            )
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "new-history-created",
                        "history_uid": history_uid,
                    }
                )
            )

    async def _handle_delete_history(
        self, websocket: WebSocket, client_uid: str, data: dict
    ):
        """Handle deletion of chat history"""
        history_uid = data.get("history_uid")
        if not history_uid:
            return

        context = self.client_contexts[client_uid]
        success = delete_history(
            context.character_config.conf_uid,
            history_uid,
        )
        await websocket.send_text(
            json.dumps(
                {
                    "type": "history-deleted",
                    "success": success,
                    "history_uid": history_uid,
                }
            )
        )
        if history_uid == context.history_uid:
            context.history_uid = None

    async def _handle_audio_data(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle incoming audio data"""
        audio_data = data.get("audio", [])
        if audio_data:
            self.received_data_buffers[client_uid] = np.append(
                self.received_data_buffers[client_uid],
                np.array(audio_data, dtype=np.float32),
            )

    async def _handle_raw_audio_data(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle incoming raw audio data for VAD processing"""
        context = self.client_contexts[client_uid]
        chunk = data.get("audio", [])
        if chunk:
            for audio_bytes in context.vad_engine.detect_speech(chunk):
                if audio_bytes == b"<|PAUSE|>":
                    await websocket.send_text(
                        json.dumps({"type": "control", "text": "interrupt"})
                    )
                elif audio_bytes == b"<|RESUME|>":
                    pass
                elif len(audio_bytes) > 1024:
                    # Detected audio activity (voice)
                    self.received_data_buffers[client_uid] = np.append(
                        self.received_data_buffers[client_uid],
                        np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32),
                    )
                    await websocket.send_text(
                        json.dumps({"type": "control", "text": "mic-audio-end"})
                    )

    async def _handle_conversation_trigger(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle triggers that start a conversation"""
        await handle_conversation_trigger(
            msg_type=data.get("type", ""),
            data=data,
            client_uid=client_uid,
            context=self.client_contexts[client_uid],
            websocket=websocket,
            client_contexts=self.client_contexts,
            client_connections=self.client_connections,
            chat_group_manager=self.chat_group_manager,
            received_data_buffers=self.received_data_buffers,
            current_conversation_tasks=self.current_conversation_tasks,
            broadcast_to_group=self.broadcast_to_group,
        )

    async def _handle_fetch_configs(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle fetching available configurations"""
        context = self.client_contexts[client_uid]
        config_files = scan_config_alts_directory(context.system_config.config_alts_dir)
        await websocket.send_text(
            json.dumps({"type": "config-files", "configs": config_files})
        )

    async def _handle_config_switch(
        self, websocket: WebSocket, client_uid: str, data: dict
    ):
        """Handle switching to a different configuration"""
        config_file_name = data.get("file")
        if config_file_name:
            context = self.client_contexts[client_uid]
            await context.handle_config_switch(websocket, config_file_name)

    async def _handle_fetch_backgrounds(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle fetching available background images"""
        bg_files = scan_bg_directory()
        await websocket.send_text(
            json.dumps({"type": "background-files", "files": bg_files})
        )

    async def _handle_audio_play_start(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """
        Handle audio playback start notification
        """
        group_members = self.chat_group_manager.get_group_members(client_uid)
        if len(group_members) > 1:
            display_text = data.get("display_text")
            if display_text:
                silent_payload = prepare_audio_payload(
                    audio_path=None,
                    display_text=display_text,
                    actions=None,
                    forwarded=True,
                )
                await self.broadcast_to_group(
                    group_members, silent_payload, exclude_uid=client_uid
                )

    async def _handle_group_info(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle group info request"""
        await self.send_group_update(websocket, client_uid)

    async def _handle_init_config_request(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle request for initialization configuration"""
        context = self.client_contexts.get(client_uid)
        if not context:
            context = self.default_context_cache

        await websocket.send_text(
            json.dumps(
                {
                    "type": "set-model-and-conf",
                    "model_info": context.live2d_model.model_info,
                    "conf_name": context.character_config.conf_name,
                    "conf_uid": context.character_config.conf_uid,
                    "client_uid": client_uid,
                }
            )
        )

    async def _handle_heartbeat(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle heartbeat messages from clients"""
        try:
            await websocket.send_json({"type": "heartbeat-ack"})
        except Exception as e:
            logger.error(f"Error sending heartbeat acknowledgment: {e}")
