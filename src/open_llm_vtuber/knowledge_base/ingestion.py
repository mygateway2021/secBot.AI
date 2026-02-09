"""
Document ingestion pipeline for knowledge base.

Handles text extraction, chunking, and indexing of uploaded documents.
"""

import asyncio
import json
import re
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from loguru import logger


class _HTMLTextExtractor(HTMLParser):
    """Extract visible text from HTML content.

    This is used for EPUB ingestion, where many documents store content as
    XHTML/HTML inside a ZIP container.
    """

    def __init__(self) -> None:
        super().__init__()
        self._parts: list[str] = []
        self._ignore_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:  # type: ignore[override]
        if tag.lower() in {"script", "style", "noscript"}:
            self._ignore_depth += 1

    def handle_endtag(self, tag: str) -> None:  # type: ignore[override]
        if tag.lower() in {"script", "style", "noscript"} and self._ignore_depth > 0:
            self._ignore_depth -= 1

    def handle_data(self, data: str) -> None:  # type: ignore[override]
        if self._ignore_depth > 0:
            return
        text = data.strip()
        if text:
            self._parts.append(text)

    def get_text(self) -> str:
        return "\n".join(self._parts)


def _normalize_text(text: str) -> str:
    """Normalize extracted text to improve chunking.

    Args:
        text: Raw extracted text.

    Returns:
        Normalized text.
    """

    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Collapse excessive whitespace while keeping paragraph-ish separation.
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


class TextChunker:
    """
    Simple text chunker that splits documents into overlapping chunks.

    Uses character-based chunking with overlap to maintain context across boundaries.
    """

    def __init__(self, chunk_size: int = 500, chunk_overlap: int = 50):
        """
        Initialize the text chunker.

        Args:
            chunk_size: Target size of each chunk in characters
            chunk_overlap: Number of overlapping characters between chunks
        """
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def chunk_text(self, text: str) -> list[dict[str, Any]]:
        """
        Split text into overlapping chunks.

        Args:
            text: Input text to chunk

        Returns:
            List of chunk dictionaries with 'text', 'chunk_index', 'start', 'end'
        """
        if not text or len(text) <= self.chunk_size:
            return [
                {
                    "text": text,
                    "chunk_index": 0,
                    "start": 0,
                    "end": len(text),
                }
            ]

        chunks = []
        start = 0
        chunk_index = 0

        while start < len(text):
            end = min(start + self.chunk_size, len(text))

            # Try to break at sentence boundaries for better chunks
            if end < len(text):
                # Look for sentence endings in the last 20% of the chunk
                search_start = max(start, end - int(self.chunk_size * 0.2))
                sentence_ends = [
                    i
                    for i in range(end - 1, search_start, -1)
                    if text[i] in ".!?。！？\n"
                ]

                if sentence_ends:
                    end = sentence_ends[0] + 1

            chunk_text = text[start:end].strip()

            if chunk_text:  # Only add non-empty chunks
                chunks.append(
                    {
                        "text": chunk_text,
                        "chunk_index": chunk_index,
                        "start": start,
                        "end": end,
                    }
                )
                chunk_index += 1

            # Move start position with overlap
            start = end - self.chunk_overlap

            # Prevent infinite loop
            if start >= len(text) or (end == len(text)):
                break

        return chunks


class DocumentProcessor:
    """
    Process uploaded documents for ingestion into the knowledge base.

    Supports text extraction from various file formats and prepares them for indexing.
    """

    def __init__(self, chunk_size: int = 500, chunk_overlap: int = 50):
        """
        Initialize the document processor.

        Args:
            chunk_size: Target chunk size in characters
            chunk_overlap: Overlap between chunks in characters
        """
        self.chunker = TextChunker(chunk_size=chunk_size, chunk_overlap=chunk_overlap)

    async def extract_text(self, file_path: Path) -> str:
        """
        Extract text content from a file.

        Currently supports:
        - .txt, .md: Plain text
        - .pdf: PDF text extraction (requires pypdf)
        - .epub: EPUB text extraction (offline, ZIP + HTML stripping)

        Args:
            file_path: Path to the file

        Returns:
            Extracted text content

        Raises:
            ValueError: If file format is not supported
        """
        suffix = file_path.suffix.lower()

        if suffix in [".txt", ".md", ".markdown"]:
            # Plain text files
            return await asyncio.to_thread(
                file_path.read_text, encoding="utf-8", errors="ignore"
            )

        if suffix == ".pdf":
            return await self._extract_pdf(file_path)

        if suffix == ".epub":
            return await self._extract_epub(file_path)

        raise ValueError(
            "Unsupported file format: "
            f"{suffix}. Currently supported: .txt, .md, .pdf, .epub"
        )

    async def _extract_pdf(self, file_path: Path) -> str:
        """Extract text from a PDF file.

        Args:
            file_path: Path to a .pdf file.

        Returns:
            Extracted text.

        Raises:
            ValueError: If PDF parsing support is not installed.
        """

        def _read_pdf() -> str:
            try:
                from pypdf import PdfReader  # type: ignore
            except Exception as e:  # pragma: no cover
                raise ValueError(
                    "PDF ingestion requires the 'pypdf' package. "
                    "Install it with `uv add pypdf`."
                ) from e

            reader = PdfReader(str(file_path))
            parts: list[str] = []
            for page in reader.pages:
                page_text = page.extract_text() or ""
                if page_text.strip():
                    parts.append(page_text)
            return _normalize_text("\n\n".join(parts))

        return await asyncio.to_thread(_read_pdf)

    async def _extract_epub(self, file_path: Path) -> str:
        """Extract text from an EPUB file.

        This implementation stays offline by treating EPUB as a ZIP archive
        and stripping text from contained HTML/XHTML files.

        Args:
            file_path: Path to a .epub file.

        Returns:
            Extracted text.
        """

        def _read_epub() -> str:
            parts: list[str] = []
            with zipfile.ZipFile(file_path) as zf:
                names = sorted(zf.namelist())
                for name in names:
                    lower = name.lower()
                    if not lower.endswith((".xhtml", ".html", ".htm")):
                        continue
                    # Skip metadata and nav-ish docs that are often noisy.
                    if lower.startswith("meta-inf/"):
                        continue
                    try:
                        raw = zf.read(name)
                    except KeyError:
                        continue

                    html_text = raw.decode("utf-8", errors="replace")
                    parser = _HTMLTextExtractor()
                    parser.feed(html_text)
                    text = parser.get_text()
                    if text.strip():
                        parts.append(text)

            return _normalize_text("\n\n".join(parts))

        return await asyncio.to_thread(_read_epub)

    async def process_document(self, file_path: Path, file_id: str) -> dict[str, Any]:
        """
        Process a document: extract text, chunk, and prepare for indexing.

        Args:
            file_path: Path to the document file
            file_id: Unique identifier for this document

        Returns:
            Dictionary with 'file_id', 'filename', 'chunks', 'text_length', 'chunk_count'
        """
        try:
            # Extract text
            text = await self.extract_text(file_path)

            if not text.strip():
                raise ValueError("Document contains no text content")

            # Chunk the text
            chunks = self.chunker.chunk_text(text)

            logger.info(
                f"📄 Processed '{file_path.name}': {len(text)} chars -> {len(chunks)} chunks"
            )

            return {
                "file_id": file_id,
                "filename": file_path.name,
                "chunks": chunks,
                "text_length": len(text),
                "chunk_count": len(chunks),
            }

        except Exception as e:
            logger.error(f"❌ Failed to process '{file_path.name}': {e}")
            raise


class IngestionPipeline:
    """
    Coordinates document ingestion: processing + indexing.

    Runs as background tasks to avoid blocking the main server.
    """

    def __init__(self, storage_manager, retriever_factory):
        """
        Initialize the ingestion pipeline.

        Args:
            storage_manager: KBStorageManager instance
            retriever_factory: Callable that returns a retriever for a given conf_uid
        """
        self.storage_manager = storage_manager
        self.retriever_factory = retriever_factory
        self.processor = DocumentProcessor()
        self._tasks: dict[str, asyncio.Task[None]] = {}  # Track background tasks

    async def ingest_document(
        self,
        conf_uid: str,
        file_id: str,
        chunk_size: int = 500,
        chunk_overlap: int = 50,
    ) -> None:
        """
        Ingest a single document: process and index.

        Args:
            conf_uid: Character configuration UID
            file_id: Document file ID
            chunk_size: Chunk size for this document
            chunk_overlap: Chunk overlap for this document
        """
        try:
            # Update status to processing
            await self.storage_manager.update_document_status(
                conf_uid, file_id, "processing"
            )

            # Find the raw file
            documents = await self.storage_manager.list_documents(conf_uid)
            doc_info = next((d for d in documents if d["file_id"] == file_id), None)

            if not doc_info:
                raise ValueError(f"Document '{file_id}' not found in metadata")

            raw_file = Path(doc_info["path"])

            if not raw_file.exists():
                raise FileNotFoundError(f"Raw file not found: {raw_file}")

            # Process document with custom chunk settings
            self.processor.chunker.chunk_size = chunk_size
            self.processor.chunker.chunk_overlap = chunk_overlap

            processed = await self.processor.process_document(raw_file, file_id)

            # Save chunks to disk
            chunks_dir = self.storage_manager.get_chunks_dir(conf_uid)
            chunk_file = chunks_dir / f"{file_id}.json"
            await asyncio.to_thread(
                chunk_file.write_text,
                json.dumps(processed, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

            # Index chunks in retriever
            retriever = self.retriever_factory(conf_uid)
            await retriever.add_chunks(
                file_id=file_id,
                filename=processed["filename"],
                chunks=processed["chunks"],
            )

            # Update status to indexed
            await self.storage_manager.update_document_status(
                conf_uid, file_id, "indexed"
            )

            logger.success(
                f"✅ Successfully ingested '{processed['filename']}' for character '{conf_uid}'"
            )

        except Exception as e:
            logger.error(
                f"❌ Ingestion failed for file_id '{file_id}' (character '{conf_uid}'): {e}"
            )
            await self.storage_manager.update_document_status(
                conf_uid, file_id, "error", error=str(e)
            )
            raise

    def ingest_document_background(
        self,
        conf_uid: str,
        file_id: str,
        chunk_size: int = 500,
        chunk_overlap: int = 50,
    ) -> asyncio.Task:
        """
        Start document ingestion as a background task.

        Args:
            conf_uid: Character configuration UID
            file_id: Document file ID
            chunk_size: Chunk size
            chunk_overlap: Chunk overlap

        Returns:
            asyncio.Task that can be awaited or tracked
        """
        task_key = f"{conf_uid}:{file_id}"

        # Cancel existing task if running
        if task_key in self._tasks and not self._tasks[task_key].done():
            self._tasks[task_key].cancel()

        # Start new background task
        task = asyncio.create_task(
            self.ingest_document(conf_uid, file_id, chunk_size, chunk_overlap)
        )
        self._tasks[task_key] = task

        logger.info(f"🚀 Started background ingestion for '{file_id}'")
        return task

    async def rebuild_index(self, conf_uid: str) -> None:
        """
        Rebuild the entire index for a character's KB.

        Re-processes and re-indexes all documents.

        Args:
            conf_uid: Character configuration UID
        """
        logger.info(f"🔄 Rebuilding index for character '{conf_uid}'...")

        documents = await self.storage_manager.list_documents(conf_uid)
        retriever = self.retriever_factory(conf_uid)

        # Clear existing index
        await retriever.clear_all()

        # Re-ingest all documents
        for doc in documents:
            file_id = doc["file_id"]
            try:
                await self.ingest_document(conf_uid, file_id)
            except Exception as e:
                logger.error(f"Failed to re-index '{file_id}': {e}")
                continue

        logger.success(f"✅ Index rebuild complete for '{conf_uid}'")
