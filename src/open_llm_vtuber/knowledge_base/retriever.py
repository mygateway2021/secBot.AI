"""SQLite FTS5-based retriever for fast keyword search in knowledge bases.

Provides offline, low-latency retrieval using SQLite's Full-Text Search capabilities.
"""

from __future__ import annotations

import re
from pathlib import Path

import aiosqlite
from loguru import logger


_FTS5_TOKEN_RE = re.compile(
    r"[A-Za-z0-9_]+|[\u3400-\u4DBF\u4E00-\u9FFF\u3005\u3040-\u30FF\uAC00-\uD7AF\uF900-\uFAFF]+"
)

_CJK_SEP_TOKEN = "__CJK_SEP__"


def _is_cjk_token(token: str) -> bool:
    """Return True if the token contains CJK characters.

    Args:
        token: Input token.

    Returns:
        True if the token contains at least one CJK character.
    """

    return any(
        (
            "\u3400" <= ch <= "\u4dbf"
            or "\u4e00" <= ch <= "\u9fff"
            or "\uf900" <= ch <= "\ufaff"
            or "\u3040" <= ch <= "\u30ff"
            or "\uac00" <= ch <= "\ud7af"
        )
        for ch in token
    )


def _build_fts5_match_query(query: str, *, max_terms: int = 24) -> str:
    """Build a safe FTS5 MATCH query with improved CJK handling.

    SQLite's default tokenization works well for whitespace-delimited languages.
    For CJK queries, users often input long strings with punctuation and no spaces.
    This helper extracts meaningful tokens and adds a small set of sub-phrases to
    improve recall while keeping the MATCH expression bounded.

    Args:
        query: Raw user query.
        max_terms: Maximum number of terms to include in the MATCH query.

    Returns:
        A sanitized FTS5 MATCH expression.
    """

    query = query.strip()
    if not query:
        return '""'

    raw_tokens = _FTS5_TOKEN_RE.findall(query)

    tokens: list[str] = []
    seen: set[str] = set()

    def add_token(token: str) -> None:
        token = token.strip()
        if not token or token in seen:
            return
        seen.add(token)
        tokens.append(token)

    # Add extracted tokens first.
    for tok in raw_tokens:
        add_token(tok)
        if len(tokens) >= max_terms:
            break

    # For long CJK runs, add limited sub-phrases to better match documents that
    # contain shorter punctuated segments (common in Chinese).
    if len(tokens) < max_terms:
        for tok in raw_tokens:
            if len(tokens) >= max_terms:
                break
            if not _is_cjk_token(tok):
                continue

            cjk = tok

            # Split on very common conjunction-like characters.
            for sep in ("和", "与", "及", "跟", "或", "但", "而"):
                cjk = cjk.replace(sep, " ")
            for part in cjk.split():
                add_token(part)
                if len(tokens) >= max_terms:
                    break

            if len(tokens) >= max_terms:
                break

            # Add a few sliding-window subphrases (length 2..6) for very long tokens.
            # This is capped to avoid slow MATCH queries.
            if len(tok) >= 8:
                for window in (4, 3, 2):
                    if len(tokens) >= max_terms:
                        break
                    for i in range(0, len(tok) - window + 1):
                        add_token(tok[i : i + window])
                        if len(tokens) >= max_terms:
                            break

    if not tokens:
        return '""'

    # Escape quotes and wrap each token in quotes for phrase matching.
    sanitized_terms: list[str] = []
    for term in tokens[:max_terms]:
        escaped = term.replace('"', '""')
        sanitized_terms.append(f'"{escaped}"')
    return " OR ".join(sanitized_terms)


def _cjk_bigrams(token: str) -> list[str]:
    """Generate CJK bigrams for a token.

    Args:
        token: A CJK token.

    Returns:
        List of overlapping 2-character grams; if the token is 1 character,
        returns a single-element list with that character.
    """

    if len(token) <= 1:
        return [token]
    return [token[i : i + 2] for i in range(len(token) - 1)]


def _build_cjk_bigram_index_text(text: str) -> str:
    """Build an indexable bigram string for CJK substring search.

    This creates a whitespace-delimited token stream so SQLite's default
    unicode tokenizer can index CJK bigrams as independent tokens.

    Args:
        text: Original chunk text.

    Returns:
        A string containing bigram tokens separated by spaces, with a separator
        token between runs.
    """

    tokens = _FTS5_TOKEN_RE.findall(text)
    out: list[str] = []
    for tok in tokens:
        if _is_cjk_token(tok):
            out.extend(_cjk_bigrams(tok))
            out.append(_CJK_SEP_TOKEN)
        else:
            # Keep non-CJK tokens so Latin queries also work here if needed.
            out.append(tok)
            out.append(_CJK_SEP_TOKEN)
    return " ".join(out)


def _build_fts5_cjk_bigram_phrase_query(query: str, *, max_phrases: int = 6) -> str:
    """Build an FTS5 MATCH expression that targets CJK bigram phrases.

    For a CJK token like '粉蒸排骨和冬瓜汤', this generates a phrase query over
    its bigrams: "粉蒸 蒸排 排骨 ...". If the bigram stream was indexed from
    the document text, this can match the token even when it appears as a
    substring inside a longer CJK run.

    Args:
        query: Raw user query.
        max_phrases: Maximum number of CJK phrases to include.

    Returns:
        An FTS5 expression like: text_ngrams:"粉蒸 蒸排 ..." OR ...
    """

    query = query.strip()
    if not query:
        return ""

    raw_tokens = _FTS5_TOKEN_RE.findall(query)
    phrases: list[str] = []

    for tok in raw_tokens:
        if not _is_cjk_token(tok):
            continue

        grams = _cjk_bigrams(tok)
        if not grams:
            continue
        phrase = " ".join(grams)
        if phrase not in phrases:
            phrases.append(phrase)
        if len(phrases) >= max_phrases:
            break

    if not phrases:
        return ""

    # Escape quotes inside phrases, then scope to the ngram column.
    parts: list[str] = []
    for phrase in phrases:
        escaped = phrase.replace('"', '""')
        parts.append(f'text_ngrams:"{escaped}"')
    return " OR ".join(parts)


class SQLiteFTS5Retriever:
    """
    Fast keyword-based retrieval using SQLite FTS5.

    Maintains an FTS5 index of text chunks for efficient search without
    requiring external services or embedding models.
    """

    def __init__(self, db_path: str | Path):
        """
        Initialize the FTS5 retriever.

        Args:
            db_path: Path to the SQLite database file
        """
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialized = False
        self._fts_table = "kb_chunks"

    async def initialize(self) -> None:
        """Create the FTS5 table if it doesn't exist."""
        if self._initialized:
            return

        async with aiosqlite.connect(self.db_path) as db:
            # V2 schema: add a CJK-friendly bigram column for substring matching.
            await db.execute(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_v2 USING fts5(
                    chunk_id UNINDEXED,
                    file_id UNINDEXED,
                    chunk_index UNINDEXED,
                    text,
                    text_ngrams,
                    metadata UNINDEXED,
                    tokenize = 'unicode61'
                )
                """
            )

            # Create metadata table for document tracking
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS kb_documents (
                    file_id TEXT PRIMARY KEY,
                    filename TEXT,
                    added_at TEXT,
                    chunk_count INTEGER
                )
                """
            )

            await db.commit()

            # Decide which FTS table to use (prefer v2).
            self._fts_table = "kb_chunks_v2"

            # One-time migration from legacy kb_chunks -> kb_chunks_v2.
            legacy_exists = await (
                await db.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='kb_chunks'"
                )
            ).fetchone()
            if legacy_exists:
                cur_v2 = await db.execute("SELECT COUNT(*) FROM kb_chunks_v2")
                v2_count = (await cur_v2.fetchone())[0]
                if v2_count == 0:
                    cur_old = await db.execute(
                        "SELECT chunk_id, file_id, chunk_index, text, metadata FROM kb_chunks"
                    )
                    rows = await cur_old.fetchall()
                    if rows:
                        logger.info(
                            f"🔁 Migrating legacy FTS rows to kb_chunks_v2 (rows={len(rows)})"
                        )
                        await db.execute("BEGIN")
                        for chunk_id, file_id, chunk_index, text, metadata in rows:
                            ngrams = _build_cjk_bigram_index_text(text or "")
                            await db.execute(
                                """
                                INSERT INTO kb_chunks_v2 (
                                    chunk_id, file_id, chunk_index, text, text_ngrams, metadata
                                ) VALUES (?, ?, ?, ?, ?, ?)
                                """,
                                (
                                    chunk_id,
                                    file_id,
                                    chunk_index,
                                    text,
                                    ngrams,
                                    metadata,
                                ),
                            )
                        await db.commit()
                        logger.info("✅ Migration to kb_chunks_v2 completed")

        self._initialized = True
        logger.info(f"✅ SQLite FTS5 index initialized at: {self.db_path}")

    async def add_chunks(
        self,
        file_id: str,
        filename: str,
        chunks: list[dict],
    ) -> None:
        """
        Add text chunks to the FTS5 index.

        Args:
            file_id: Unique identifier for the document
            filename: Original filename
            chunks: List of chunk dictionaries with 'text', 'chunk_index', and optional 'metadata'
        """
        await self.initialize()

        async with aiosqlite.connect(self.db_path) as db:
            # Remove existing chunks for this file_id (re-indexing case)
            await db.execute(
                f"DELETE FROM {self._fts_table} WHERE file_id = ?", (file_id,)
            )
            await db.execute("DELETE FROM kb_documents WHERE file_id = ?", (file_id,))

            # Insert new chunks
            for chunk in chunks:
                chunk_id = f"{file_id}_{chunk['chunk_index']}"
                text = chunk["text"]
                ngrams = _build_cjk_bigram_index_text(text)
                await db.execute(
                    """
                    INSERT INTO kb_chunks_v2 (chunk_id, file_id, chunk_index, text, text_ngrams, metadata)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        chunk_id,
                        file_id,
                        chunk["chunk_index"],
                        text,
                        ngrams,
                        chunk.get("metadata", ""),
                    ),
                )

            # Record document metadata
            await db.execute(
                """
                INSERT INTO kb_documents (file_id, filename, added_at, chunk_count)
                VALUES (?, ?, datetime('now'), ?)
                """,
                (file_id, filename, len(chunks)),
            )

            await db.commit()

        logger.info(
            f"📚 Indexed {len(chunks)} chunks for file '{filename}' (ID: {file_id})"
        )

    async def search(
        self,
        query: str,
        top_k: int = 3,
        max_chars: int | None = None,
    ) -> list[dict]:
        """
        Search for relevant chunks using FTS5.

        Args:
            query: Search query text
            top_k: Number of top results to return
            max_chars: Maximum total characters to return (for context budget)

        Returns:
            List of result dictionaries with 'text', 'file_id', 'filename', 'chunk_index', 'rank'
        """
        await self.initialize()

        if not query.strip():
            return []

        text_query = _build_fts5_match_query(query)
        ngram_query = _build_fts5_cjk_bigram_phrase_query(query)
        sanitized_query = (
            f"({text_query}) OR ({ngram_query})" if ngram_query else text_query
        )

        async with aiosqlite.connect(self.db_path) as db:
            # Use FTS5 MATCH for full-text search with BM25 ranking
            cursor = await db.execute(
                """
                SELECT 
                    c.chunk_id,
                    c.file_id,
                    c.chunk_index,
                    c.text,
                    c.metadata,
                    d.filename,
                    bm25(kb_chunks_v2) as rank
                FROM kb_chunks_v2 c
                JOIN kb_documents d ON c.file_id = d.file_id
                WHERE kb_chunks_v2 MATCH ?
                ORDER BY rank
                LIMIT ?
                """,
                (sanitized_query, top_k * 2),  # Fetch more than needed for filtering
            )

            rows = await cursor.fetchall()

        results: list[dict] = []
        total_chars = 0

        for row in rows:
            chunk_id, file_id, chunk_index, text, metadata, filename, rank = row

            # Apply character limit if specified
            if max_chars and total_chars + len(text) > max_chars:
                if len(results) == 0:
                    # Include at least one result, truncated
                    remaining = max_chars - total_chars
                    text = text[:remaining] + "..."
                    results.append(
                        {
                            "chunk_id": chunk_id,
                            "file_id": file_id,
                            "filename": filename,
                            "chunk_index": chunk_index,
                            "text": text,
                            "rank": rank,
                            "truncated": True,
                        }
                    )
                break

            results.append(
                {
                    "chunk_id": chunk_id,
                    "file_id": file_id,
                    "filename": filename,
                    "chunk_index": chunk_index,
                    "text": text,
                    "rank": rank,
                    "truncated": False,
                }
            )

            total_chars += len(text)

            if len(results) >= top_k:
                break

        logger.debug(
            f"🔍 Found {len(results)} results for query '{query[:50]}...' (total chars: {total_chars})"
        )

        return results

    async def delete_document(self, file_id: str) -> int:
        """
        Delete all chunks for a specific document.

        Args:
            file_id: Document file ID to delete

        Returns:
            Number of chunks deleted
        """
        await self.initialize()

        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                "DELETE FROM kb_chunks_v2 WHERE file_id = ?", (file_id,)
            )
            chunks_deleted = cursor.rowcount

            await db.execute("DELETE FROM kb_documents WHERE file_id = ?", (file_id,))
            await db.commit()

        logger.info(f"🗑️ Deleted {chunks_deleted} chunks for file_id '{file_id}'")
        return chunks_deleted

    async def get_stats(self) -> dict[str, int]:
        """
        Get statistics about the indexed knowledge base.

        Returns:
            Dictionary with 'total_documents', 'total_chunks', 'db_size_bytes'
        """
        await self.initialize()

        async with aiosqlite.connect(self.db_path) as db:
            total_docs = 0
            total_chunks = 0

            try:
                cursor = await db.execute("SELECT COUNT(*) FROM kb_documents")
                row = await cursor.fetchone()
                total_docs = int(row[0]) if row else 0
            except aiosqlite.Error:
                # KB not initialized yet (or schema missing). Treat as empty.
                total_docs = 0

            # Prefer the active FTS table determined by initialize() (v2 by default).
            # For safety, fall back to v2 then legacy table if needed.
            candidate_tables = [self._fts_table, "kb_chunks_v2", "kb_chunks"]
            for table in candidate_tables:
                if not table:
                    continue
                try:
                    cursor = await db.execute(f"SELECT COUNT(*) FROM {table}")
                    row = await cursor.fetchone()
                    total_chunks = int(row[0]) if row else 0
                    break
                except aiosqlite.Error:
                    continue

        db_size = self.db_path.stat().st_size if self.db_path.exists() else 0

        return {
            "total_documents": total_docs,
            "total_chunks": total_chunks,
            "db_size_bytes": db_size,
        }

    async def clear_all(self) -> None:
        """Clear all documents and chunks from the index."""
        await self.initialize()

        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("DELETE FROM kb_chunks_v2")
            await db.execute("DELETE FROM kb_documents")
            await db.commit()

        logger.warning("🗑️ Cleared all indexed documents and chunks")
