"""Unit tests for knowledge base ingestion file formats.

These tests validate offline text extraction for supported KB document formats.

They are intentionally small and self-contained (no server required).
"""

from __future__ import annotations

import tempfile
import unittest
import zipfile
from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = PROJECT_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


class TestKnowledgeBaseIngestionFormats(unittest.IsolatedAsyncioTestCase):
    """Tests for `DocumentProcessor.extract_text` format support."""

    async def test_extract_epub_text(self) -> None:
        """Extracts text from a minimal EPUB (ZIP + XHTML)."""
        from open_llm_vtuber.knowledge_base.ingestion import DocumentProcessor

        processor = DocumentProcessor()

        with tempfile.TemporaryDirectory() as tmp:
            epub_path = Path(tmp) / "sample.epub"

            # Minimal EPUB-like ZIP. Our extractor only needs HTML/XHTML entries.
            with zipfile.ZipFile(epub_path, "w") as zf:
                zf.writestr(
                    "OEBPS/content.xhtml",
                    """<?xml version='1.0' encoding='utf-8'?>
<html xmlns='http://www.w3.org/1999/xhtml'>
  <head><title>t</title><style>.x{color:red}</style></head>
  <body>
    <h1>Hello EPUB</h1>
    <p>Second line.</p>
    <script>console.log('ignore');</script>
  </body>
</html>
""",
                )

            text = await processor.extract_text(epub_path)

        self.assertIn("Hello EPUB", text)
        self.assertIn("Second line.", text)
        self.assertNotIn("console.log", text)

    async def test_extract_pdf_empty_pdf_does_not_crash(self) -> None:
        """Handles a minimal PDF container without crashing.

        We only assert that extraction runs and returns a string; content may be
        empty depending on PDF structure.
        """
        from open_llm_vtuber.knowledge_base.ingestion import DocumentProcessor

        processor = DocumentProcessor()

        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "empty.pdf"

            # Create a structurally-valid PDF without text.
            from pypdf import PdfWriter

            writer = PdfWriter()
            writer.add_blank_page(width=72, height=72)
            with pdf_path.open("wb") as f:
                writer.write(f)

            text = await processor.extract_text(pdf_path)

        self.assertIsInstance(text, str)


if __name__ == "__main__":
    unittest.main()
