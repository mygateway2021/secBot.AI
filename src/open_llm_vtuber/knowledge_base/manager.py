"""
Main knowledge base manager interface.

Coordinates storage, retrieval, and ingestion for per-character knowledge bases.
"""

from typing import Dict, List, Optional
from pathlib import Path
from loguru import logger

from .storage_manager import KBStorageManager
from .retriever import SQLiteFTS5Retriever
from .ingestion import IngestionPipeline


class KnowledgeBaseManager:
    """
    High-level manager for character knowledge bases.

    Provides a unified interface for upload, retrieval, and management operations.
    """

    def __init__(self, base_dir: str | Path = "knowledge_base"):
        """
        Initialize the knowledge base manager.

        Args:
            base_dir: Base directory for all knowledge bases
        """
        self.storage = KBStorageManager(base_dir)
        self._retrievers: Dict[str, SQLiteFTS5Retriever] = {}

        # Initialize ingestion pipeline
        self.ingestion = IngestionPipeline(
            storage_manager=self.storage,
            retriever_factory=self._get_retriever,
        )

        logger.info("🧠 Knowledge Base Manager initialized")

    def _get_retriever(self, conf_uid: str) -> SQLiteFTS5Retriever:
        """
        Get or create a retriever instance for a character.

        Args:
            conf_uid: Character configuration UID

        Returns:
            SQLiteFTS5Retriever instance
        """
        if conf_uid not in self._retrievers:
            db_path = self.storage.get_db_path(conf_uid)
            self._retrievers[conf_uid] = SQLiteFTS5Retriever(db_path)

        return self._retrievers[conf_uid]

    async def upload_document(
        self, conf_uid: str, filename: str, content: bytes
    ) -> Dict:
        """
        Upload a document to a character's knowledge base.

        Args:
            conf_uid: Character configuration UID
            filename: Original filename
            content: File content as bytes

        Returns:
            Document metadata including file_id
        """
        # Save the file
        doc_info = await self.storage.save_uploaded_file(conf_uid, filename, content)

        # Add to metadata
        await self.storage.add_document_to_metadata(conf_uid, doc_info)

        logger.info(f"📤 Uploaded '{filename}' for character '{conf_uid}'")
        return doc_info

    async def ingest_document(
        self,
        conf_uid: str,
        file_id: str,
        background: bool = True,
        chunk_size: Optional[int] = None,
        chunk_overlap: Optional[int] = None,
    ) -> Optional[Dict]:
        """
        Ingest a document into the knowledge base.

        Args:
            conf_uid: Character configuration UID
            file_id: Document file ID
            background: Whether to run ingestion in background (default: True)
            chunk_size: Optional custom chunk size (defaults to config)
            chunk_overlap: Optional custom chunk overlap (defaults to config)

        Returns:
            Task info if background=True, None if background=False (blocking)
        """
        # Use defaults if not specified
        chunk_size = chunk_size or 500
        chunk_overlap = chunk_overlap or 50

        if background:
            task = self.ingestion.ingest_document_background(
                conf_uid, file_id, chunk_size, chunk_overlap
            )
            return {"task_id": f"{conf_uid}:{file_id}", "status": "processing"}
        else:
            await self.ingestion.ingest_document(
                conf_uid, file_id, chunk_size, chunk_overlap
            )
            return None

    async def retrieve(
        self,
        conf_uid: str,
        query: str,
        top_k: int = 3,
        max_chars: Optional[int] = 2000,
    ) -> List[Dict]:
        """
        Retrieve relevant knowledge chunks for a query.

        Args:
            conf_uid: Character configuration UID
            query: Search query
            top_k: Number of results to retrieve
            max_chars: Maximum total characters to return

        Returns:
            List of result dictionaries with 'text', 'file_id', 'filename', 'original_filename', etc.
        """
        retriever = self._get_retriever(conf_uid)
        logger.info(
            f"🔍 KB Manager: Searching for query='{query[:100]}...', top_k={top_k}, max_chars={max_chars}"
        )

        results = await retriever.search(query, top_k=top_k, max_chars=max_chars)

        # Enrich results with original filenames from metadata
        if results:
            metadata = await self.storage.load_metadata(conf_uid)
            file_id_to_original = {
                doc["file_id"]: doc.get(
                    "original_filename", doc.get("stored_filename", "Unknown")
                )
                for doc in metadata.get("documents", [])
            }

            for result in results:
                file_id = result.get("file_id")
                if file_id and file_id in file_id_to_original:
                    result["original_filename"] = file_id_to_original[file_id]
                else:
                    result["original_filename"] = result.get("filename", "Unknown")

        logger.info(
            f"✅ KB Manager: Retrieved {len(results)} results for character '{conf_uid}'"
        )
        if results:
            for i, result in enumerate(results[:3]):  # Log first 3 results
                logger.debug(
                    f"  Result {i + 1}: {result.get('original_filename', result['filename'])} - {result['text'][:100]}..."
                )

        return results

    async def list_documents(self, conf_uid: str) -> List[Dict]:
        """
        List all documents in a character's knowledge base.

        Args:
            conf_uid: Character configuration UID

        Returns:
            List of document metadata dictionaries
        """
        return await self.storage.list_documents(conf_uid)

    async def delete_document(self, conf_uid: str, file_id: str) -> bool:
        """
        Delete a document from the knowledge base.

        Args:
            conf_uid: Character configuration UID
            file_id: Document file ID to delete

        Returns:
            True if deleted, False if not found
        """
        # Delete from index
        retriever = self._get_retriever(conf_uid)
        await retriever.delete_document(file_id)

        # Delete from storage
        deleted = await self.storage.delete_document(conf_uid, file_id)

        if deleted:
            logger.info(
                f"🗑️ Deleted document '{file_id}' from character '{conf_uid}' KB"
            )

        return deleted

    async def rebuild_index(self, conf_uid: str) -> None:
        """
        Rebuild the entire index for a character's knowledge base.

        Args:
            conf_uid: Character configuration UID
        """
        await self.ingestion.rebuild_index(conf_uid)

    async def get_stats(self, conf_uid: str) -> Dict:
        """
        Get statistics about a character's knowledge base.

        Args:
            conf_uid: Character configuration UID

        Returns:
            Statistics dictionary
        """
        retriever = self._get_retriever(conf_uid)
        index_stats = await retriever.get_stats()

        documents = await self.storage.list_documents(conf_uid)
        doc_stats = {
            "total_documents": len(documents),
            "by_status": {},
        }

        for doc in documents:
            status = doc.get("status", "unknown")
            doc_stats["by_status"][status] = doc_stats["by_status"].get(status, 0) + 1

        return {
            **index_stats,
            **doc_stats,
        }

    async def format_retrieved_context(
        self, results: List[Dict], include_sources: bool = True
    ) -> str:
        """
        Format retrieved results into a context string for LLM injection.

        Args:
            results: List of retrieval results
            include_sources: Whether to include source filenames

        Returns:
            Formatted context string
        """
        if not results:
            return ""

        lines = ["[Retrieved Knowledge Base Context]"]

        for i, result in enumerate(results, 1):
            text = result["text"]
            if include_sources:
                source = f"(Source: {result['filename']})"
                lines.append(f"{i}. {text} {source}")
            else:
                lines.append(f"{i}. {text}")

        lines.append("[End of Retrieved Context]")

        return "\n".join(lines)
