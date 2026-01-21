"""
Configuration models for per-character knowledge base (RAG) settings.
"""

from pydantic import BaseModel, Field
from typing import Dict, ClassVar, Literal, Optional
from .i18n import I18nMixin, Description


class KnowledgeBaseConfig(I18nMixin, BaseModel):
    """Configuration for per-character knowledge base."""

    enabled: bool = Field(False, alias="enabled")
    backend: Literal["sqlite_fts5", "embeddings"] = Field(
        "sqlite_fts5", alias="backend"
    )
    top_k: int = Field(3, alias="top_k")
    max_context_chars: int = Field(2000, alias="max_context_chars")
    chunk_size: int = Field(500, alias="chunk_size")
    chunk_overlap: int = Field(50, alias="chunk_overlap")
    min_similarity: Optional[float] = Field(0.3, alias="min_similarity")

    DESCRIPTIONS: ClassVar[Dict[str, Description]] = {
        "enabled": Description(
            en="Whether to enable knowledge base for this character (default: False)",
            zh="是否为该角色启用知识库（默认：False）",
        ),
        "backend": Description(
            en="Retrieval backend: 'sqlite_fts5' (fast, keyword-based, offline) or 'embeddings' (semantic, requires model)",
            zh="检索后端：'sqlite_fts5'（快速、关键词、离线）或 'embeddings'（语义、需要模型）",
        ),
        "top_k": Description(
            en="Number of top results to retrieve (default: 3)",
            zh="检索结果数量（默认：3）",
        ),
        "max_context_chars": Description(
            en="Maximum characters of retrieved context to inject into prompt (default: 2000)",
            zh="注入提示词的检索上下文最大字符数（默认：2000）",
        ),
        "chunk_size": Description(
            en="Size of text chunks for indexing (default: 500 chars)",
            zh="索引文本块大小（默认：500字符）",
        ),
        "chunk_overlap": Description(
            en="Overlap between chunks to maintain context (default: 50 chars)",
            zh="文本块之间的重叠部分以保持上下文（默认：50字符）",
        ),
        "min_similarity": Description(
            en="Minimum similarity score for retrieved results (0.0-1.0, default: 0.3)",
            zh="检索结果的最小相似度分数（0.0-1.0，默认：0.3）",
        ),
    }
