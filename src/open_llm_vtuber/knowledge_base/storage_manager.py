"""
Knowledge base storage manager for per-character document storage and indexing.

Handles file storage, path safety, and directory management for character-specific
knowledge bases following the same patterns as chat_history and diary managers.
"""

import asyncio
import hashlib
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from loguru import logger


class KBStorageManager:
    """
    Manages storage layout for per-character knowledge bases.

    Directory structure:
        knowledge_base/{conf_uid}/
            raw/          # Original uploaded files
            chunks/       # Chunked and preprocessed text
            index/        # SQLite FTS5 database or vector index
            metadata.json # Document metadata and status
    """

    def __init__(self, base_dir: str | Path = "knowledge_base"):
        """
        Initialize the KB storage manager.

        Args:
            base_dir: Base directory for all knowledge bases (default: "knowledge_base")
        """
        self.base_dir = Path(base_dir).resolve()
        self.base_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"📚 KB storage initialized at: {self.base_dir}")

    def _sanitize_conf_uid(self, conf_uid: str) -> str:
        """
        Sanitize conf_uid to prevent path traversal attacks.

        Args:
            conf_uid: Character configuration UID

        Returns:
            Sanitized conf_uid safe for filesystem use

        Raises:
            ValueError: If conf_uid is invalid or contains dangerous characters
        """
        if not conf_uid:
            raise ValueError("conf_uid cannot be empty")

        # Remove any path separators and dangerous characters
        sanitized = re.sub(r'[<>:"|?*\\/]', "", conf_uid)

        # Remove any leading/trailing dots or spaces
        sanitized = sanitized.strip(". ")

        if not sanitized or sanitized != conf_uid:
            raise ValueError(
                f"Invalid conf_uid: '{conf_uid}'. Must not contain path separators or special characters."
            )

        # Additional safety: ensure it doesn't start with '..'
        if sanitized.startswith(".."):
            raise ValueError(f"Invalid conf_uid: '{conf_uid}' cannot start with '..'")

        return sanitized

    def _sanitize_filename(self, filename: str) -> str:
        """
        Sanitize filename to prevent path traversal.

        Args:
            filename: Original filename

        Returns:
            Sanitized filename safe for storage
        """
        # Remove path components, keep only basename
        filename = os.path.basename(filename)

        # Remove dangerous characters but keep extension
        sanitized = re.sub(r'[<>:"|?*\\/ ]', "_", filename)

        return sanitized or "unnamed_file"

    def get_character_kb_dir(self, conf_uid: str) -> Path:
        """
        Get the knowledge base directory for a specific character.

        Args:
            conf_uid: Character configuration UID

        Returns:
            Path to character's KB directory
        """
        sanitized_uid = self._sanitize_conf_uid(conf_uid)
        kb_dir = self.base_dir / sanitized_uid
        kb_dir.mkdir(parents=True, exist_ok=True)
        return kb_dir

    def get_raw_dir(self, conf_uid: str) -> Path:
        """Get directory for raw uploaded files."""
        raw_dir = self.get_character_kb_dir(conf_uid) / "raw"
        raw_dir.mkdir(parents=True, exist_ok=True)
        return raw_dir

    def get_chunks_dir(self, conf_uid: str) -> Path:
        """Get directory for processed text chunks."""
        chunks_dir = self.get_character_kb_dir(conf_uid) / "chunks"
        chunks_dir.mkdir(parents=True, exist_ok=True)
        return chunks_dir

    def get_index_dir(self, conf_uid: str) -> Path:
        """Get directory for index files."""
        index_dir = self.get_character_kb_dir(conf_uid) / "index"
        index_dir.mkdir(parents=True, exist_ok=True)
        return index_dir

    def get_metadata_path(self, conf_uid: str) -> Path:
        """Get path to metadata.json for this character's KB."""
        return self.get_character_kb_dir(conf_uid) / "metadata.json"

    async def save_uploaded_file(
        self, conf_uid: str, filename: str, content: bytes
    ) -> Dict:
        """
        Save an uploaded file to the raw directory.

        Args:
            conf_uid: Character configuration UID
            filename: Original filename
            content: File content as bytes

        Returns:
            Dictionary with file metadata (file_id, path, size, hash, timestamp)
        """
        sanitized_filename = self._sanitize_filename(filename)
        raw_dir = self.get_raw_dir(conf_uid)

        # Generate unique file ID using hash + timestamp
        file_hash = hashlib.sha256(content).hexdigest()[:16]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        file_id = f"{timestamp}_{file_hash}"

        # Preserve extension
        ext = Path(sanitized_filename).suffix
        stored_filename = f"{file_id}{ext}"
        file_path = raw_dir / stored_filename

        # Write file
        await asyncio.to_thread(file_path.write_bytes, content)

        logger.info(
            f"💾 Saved file '{filename}' -> '{stored_filename}' for character '{conf_uid}'"
        )

        return {
            "file_id": file_id,
            "original_filename": filename,
            "stored_filename": stored_filename,
            "path": str(file_path),
            "size": len(content),
            "hash": file_hash,
            "timestamp": timestamp,
            "status": "uploaded",
        }

    async def load_metadata(self, conf_uid: str) -> Dict:
        """
        Load metadata.json for a character's KB.

        Args:
            conf_uid: Character configuration UID

        Returns:
            Metadata dictionary with 'documents' list and 'last_updated'
        """
        metadata_path = self.get_metadata_path(conf_uid)

        if not metadata_path.exists():
            return {"documents": [], "last_updated": None}

        try:
            content = await asyncio.to_thread(metadata_path.read_text, encoding="utf-8")
            return json.loads(content)
        except Exception as e:
            logger.error(f"❌ Failed to load metadata for '{conf_uid}': {e}")
            return {"documents": [], "last_updated": None}

    async def save_metadata(self, conf_uid: str, metadata: Dict) -> None:
        """
        Save metadata.json for a character's KB.

        Args:
            conf_uid: Character configuration UID
            metadata: Metadata dictionary to save
        """
        metadata_path = self.get_metadata_path(conf_uid)
        metadata["last_updated"] = datetime.now().isoformat()

        try:
            content = json.dumps(metadata, indent=2, ensure_ascii=False)
            await asyncio.to_thread(
                metadata_path.write_text, content, encoding="utf-8"
            )
            logger.debug(f"📝 Saved metadata for '{conf_uid}'")
        except Exception as e:
            logger.error(f"❌ Failed to save metadata for '{conf_uid}': {e}")
            raise

    async def add_document_to_metadata(
        self, conf_uid: str, doc_info: Dict
    ) -> None:
        """
        Add a document entry to metadata.

        Args:
            conf_uid: Character configuration UID
            doc_info: Document information dictionary
        """
        metadata = await self.load_metadata(conf_uid)
        metadata["documents"].append(doc_info)
        await self.save_metadata(conf_uid, metadata)

    async def update_document_status(
        self, conf_uid: str, file_id: str, status: str, error: Optional[str] = None
    ) -> None:
        """
        Update the status of a document in metadata.

        Args:
            conf_uid: Character configuration UID
            file_id: Document file ID
            status: New status ('uploaded', 'processing', 'indexed', 'error')
            error: Optional error message if status is 'error'
        """
        metadata = await self.load_metadata(conf_uid)

        for doc in metadata["documents"]:
            if doc["file_id"] == file_id:
                doc["status"] = status
                if error:
                    doc["error"] = error
                doc["updated_at"] = datetime.now().isoformat()
                break

        await self.save_metadata(conf_uid, metadata)

    async def list_documents(self, conf_uid: str) -> List[Dict]:
        """
        List all documents for a character.

        Args:
            conf_uid: Character configuration UID

        Returns:
            List of document metadata dictionaries
        """
        metadata = await self.load_metadata(conf_uid)
        return metadata.get("documents", [])

    async def delete_document(self, conf_uid: str, file_id: str) -> bool:
        """
        Delete a document and its associated files.

        Args:
            conf_uid: Character configuration UID
            file_id: Document file ID to delete

        Returns:
            True if deleted, False if not found
        """
        metadata = await self.load_metadata(conf_uid)
        documents = metadata.get("documents", [])

        # Find and remove from metadata
        doc_to_remove = None
        for i, doc in enumerate(documents):
            if doc["file_id"] == file_id:
                doc_to_remove = documents.pop(i)
                break

        if not doc_to_remove:
            return False

        # Delete physical files
        raw_dir = self.get_raw_dir(conf_uid)
        chunks_dir = self.get_chunks_dir(conf_uid)

        # Delete raw file
        stored_filename = doc_to_remove.get("stored_filename")
        if stored_filename:
            raw_file = raw_dir / stored_filename
            if raw_file.exists():
                await asyncio.to_thread(raw_file.unlink)

        # Delete chunk files (if they exist)
        chunk_file = chunks_dir / f"{file_id}.json"
        if chunk_file.exists():
            await asyncio.to_thread(chunk_file.unlink)

        # Save updated metadata
        await self.save_metadata(conf_uid, metadata)

        logger.info(f"🗑️ Deleted document '{file_id}' for character '{conf_uid}'")
        return True

    def get_db_path(self, conf_uid: str) -> Path:
        """
        Get the path to the SQLite database for this character's KB.

        Args:
            conf_uid: Character configuration UID

        Returns:
            Path to the SQLite database file
        """
        return self.get_index_dir(conf_uid) / "kb.db"
