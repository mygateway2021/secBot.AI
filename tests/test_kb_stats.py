"""Unit tests for knowledge base statistics.

These tests ensure KB endpoints can report stats for characters
that have no KB created yet (empty database / empty index).
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = PROJECT_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


class TestKnowledgeBaseStats(unittest.IsolatedAsyncioTestCase):
    """Tests for `SQLiteFTS5Retriever.get_stats` behavior on empty KB."""

    async def test_get_stats_empty_db_returns_zero_counts(self) -> None:
        """Returns zeros (and does not raise) for a new/empty KB."""
        from open_llm_vtuber.knowledge_base.retriever import SQLiteFTS5Retriever

        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "kb.sqlite"
            retriever = SQLiteFTS5Retriever(db_path)

            stats = await retriever.get_stats()

        self.assertIsInstance(stats, dict)
        self.assertIn("total_documents", stats)
        self.assertIn("total_chunks", stats)
        self.assertIn("db_size_bytes", stats)
        self.assertEqual(stats["total_documents"], 0)
        self.assertEqual(stats["total_chunks"], 0)
        self.assertGreaterEqual(stats["db_size_bytes"], 0)


if __name__ == "__main__":
    unittest.main()
