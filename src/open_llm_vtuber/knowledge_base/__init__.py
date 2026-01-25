"""
Knowledge base module for per-character document storage and retrieval.

Provides RAG (Retrieval-Augmented Generation) capabilities with offline support.
"""

from .manager import KnowledgeBaseManager
from .storage_manager import KBStorageManager
from .retriever import SQLiteFTS5Retriever
from .ingestion import IngestionPipeline, DocumentProcessor, TextChunker

__all__ = [
    "KnowledgeBaseManager",
    "KBStorageManager",
    "SQLiteFTS5Retriever",
    "IngestionPipeline",
    "DocumentProcessor",
    "TextChunker",
]
