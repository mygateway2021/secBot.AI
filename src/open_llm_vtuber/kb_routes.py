"""
FastAPI routes for knowledge base operations.

Provides HTTP endpoints for uploading, listing, deleting documents,
and managing character-specific knowledge bases.
"""

from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from loguru import logger
from pathlib import Path

from .knowledge_base import KnowledgeBaseManager
from .service_context import ServiceContext


class IngestionRequest(BaseModel):
    """Request body for triggering document ingestion."""

    file_id: str
    chunk_size: int | None = 500
    chunk_overlap: int | None = 50
    background: bool = True


class RetrievalRequest(BaseModel):
    """Request body for testing retrieval."""

    query: str
    top_k: int = 3
    max_chars: int | None = 2000


def init_kb_routes(
    kb_manager: KnowledgeBaseManager, context_cache: ServiceContext
) -> APIRouter:
    """
    Create and return API routes for knowledge base operations.

    Args:
        kb_manager: KnowledgeBaseManager instance
        context_cache: Service context cache

    Returns:
        APIRouter: Configured router with KB endpoints
    """
    router = APIRouter(prefix="/kb", tags=["knowledge_base"])

    @router.post("/{conf_uid}/upload")
    async def upload_document(
        conf_uid: str,
        file: UploadFile = File(...),
        auto_ingest: bool = Query(
            True, description="Automatically ingest after upload"
        ),
    ):
        """
        Upload a document to a character's knowledge base.

        Args:
            conf_uid: Character configuration UID
            file: Uploaded file
            auto_ingest: Whether to automatically start ingestion

        Returns:
            Document metadata including file_id
        """
        try:
            # Validate file type
            if not file.filename:
                raise HTTPException(status_code=400, detail="Filename is required")

            suffix = Path(file.filename).suffix.lower()
            allowed = {".txt", ".md", ".markdown", ".pdf", ".epub"}
            if suffix not in allowed:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Unsupported file format: "
                        f"{suffix}. Currently supported: .txt, .md, .pdf, .epub"
                    ),
                )

            # Read file content
            content = await file.read()

            if not content:
                raise HTTPException(status_code=400, detail="File is empty")

            # Upload to storage
            doc_info = await kb_manager.upload_document(
                conf_uid=conf_uid,
                filename=file.filename,
                content=content,
            )

            # Auto-ingest if requested
            if auto_ingest:
                # Get KB config from character config if available
                chunk_size = 500
                chunk_overlap = 50

                # Try to get config from context
                try:
                    char_config = context_cache.config.character_config
                    if char_config.knowledge_base:
                        chunk_size = char_config.knowledge_base.chunk_size
                        chunk_overlap = char_config.knowledge_base.chunk_overlap
                except Exception:
                    pass  # Use defaults

                ingest_result = await kb_manager.ingest_document(
                    conf_uid=conf_uid,
                    file_id=doc_info["file_id"],
                    background=True,
                    chunk_size=chunk_size,
                    chunk_overlap=chunk_overlap,
                )

                doc_info["ingestion"] = ingest_result

            return JSONResponse(
                status_code=200,
                content={
                    "success": True,
                    "message": f"File '{file.filename}' uploaded successfully",
                    "data": doc_info,
                },
            )

        except ValueError as e:
            logger.error(f"Validation error during upload: {e}")
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            logger.error(f"Failed to upload document: {e}")
            raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

    @router.post("/{conf_uid}/ingest")
    async def ingest_document(conf_uid: str, request: IngestionRequest):
        """
        Trigger ingestion for an uploaded document.

        Args:
            conf_uid: Character configuration UID
            request: Ingestion parameters

        Returns:
            Ingestion task info
        """
        try:
            result = await kb_manager.ingest_document(
                conf_uid=conf_uid,
                file_id=request.file_id,
                background=request.background,
                chunk_size=request.chunk_size,
                chunk_overlap=request.chunk_overlap,
            )

            return JSONResponse(
                status_code=200,
                content={
                    "success": True,
                    "message": "Ingestion started"
                    if request.background
                    else "Ingestion completed",
                    "data": result or {"status": "completed"},
                },
            )

        except Exception as e:
            logger.error(f"Failed to ingest document: {e}")
            raise HTTPException(status_code=500, detail=f"Ingestion failed: {str(e)}")

    @router.get("/{conf_uid}/documents")
    async def list_documents(conf_uid: str):
        """
        List all documents in a character's knowledge base.

        Args:
            conf_uid: Character configuration UID

        Returns:
            List of documents with metadata
        """
        try:
            documents = await kb_manager.list_documents(conf_uid)

            return JSONResponse(
                status_code=200,
                content={
                    "success": True,
                    "data": {
                        "conf_uid": conf_uid,
                        "documents": documents,
                        "count": len(documents),
                    },
                },
            )

        except Exception as e:
            logger.error(f"Failed to list documents: {e}")
            raise HTTPException(status_code=500, detail=f"List failed: {str(e)}")

    @router.delete("/{conf_uid}/documents/{file_id}")
    async def delete_document(conf_uid: str, file_id: str):
        """
        Delete a document from the knowledge base.

        Args:
            conf_uid: Character configuration UID
            file_id: Document file ID to delete

        Returns:
            Deletion confirmation
        """
        try:
            deleted = await kb_manager.delete_document(conf_uid, file_id)

            if not deleted:
                raise HTTPException(
                    status_code=404,
                    detail=f"Document '{file_id}' not found in KB for '{conf_uid}'",
                )

            return JSONResponse(
                status_code=200,
                content={
                    "success": True,
                    "message": f"Document '{file_id}' deleted successfully",
                },
            )

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to delete document: {e}")
            raise HTTPException(status_code=500, detail=f"Delete failed: {str(e)}")

    @router.post("/{conf_uid}/rebuild")
    async def rebuild_index(conf_uid: str):
        """
        Rebuild the entire knowledge base index for a character.

        Args:
            conf_uid: Character configuration UID

        Returns:
            Rebuild confirmation
        """
        try:
            await kb_manager.rebuild_index(conf_uid)

            return JSONResponse(
                status_code=200,
                content={
                    "success": True,
                    "message": f"Index rebuild completed for '{conf_uid}'",
                },
            )

        except Exception as e:
            logger.error(f"Failed to rebuild index: {e}")
            raise HTTPException(status_code=500, detail=f"Rebuild failed: {str(e)}")

    @router.get("/{conf_uid}/stats")
    async def get_stats(conf_uid: str):
        """
        Get statistics about a character's knowledge base.

        Args:
            conf_uid: Character configuration UID

        Returns:
            KB statistics
        """
        try:
            stats = await kb_manager.get_stats(conf_uid)

            return JSONResponse(
                status_code=200,
                content={
                    "success": True,
                    "data": {
                        "conf_uid": conf_uid,
                        **stats,
                    },
                },
            )

        except Exception as e:
            logger.error(f"Failed to get stats: {e}")
            raise HTTPException(status_code=500, detail=f"Stats failed: {str(e)}")

    @router.post("/{conf_uid}/test-retrieval")
    async def test_retrieval(conf_uid: str, request: RetrievalRequest):
        """
        Test retrieval with a query (for debugging/testing).

        Args:
            conf_uid: Character configuration UID
            request: Retrieval parameters

        Returns:
            Retrieved results
        """
        try:
            results = await kb_manager.retrieve(
                conf_uid=conf_uid,
                query=request.query,
                top_k=request.top_k,
                max_chars=request.max_chars,
            )

            # Format as context
            formatted_context = await kb_manager.format_retrieved_context(results)

            return JSONResponse(
                status_code=200,
                content={
                    "success": True,
                    "data": {
                        "query": request.query,
                        "results": results,
                        "count": len(results),
                        "formatted_context": formatted_context,
                    },
                },
            )

        except Exception as e:
            logger.error(f"Failed to retrieve: {e}")
            raise HTTPException(status_code=500, detail=f"Retrieval failed: {str(e)}")

    return router
