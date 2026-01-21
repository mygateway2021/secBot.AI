# Knowledge Base (RAG) Feature Documentation

## Overview

The Knowledge Base feature adds Retrieval-Augmented Generation (RAG) capabilities to Open-LLM-VTuber, allowing each character to have their own document repository. When you chat with a character, the AI can retrieve relevant information from their knowledge base to provide more accurate and contextual responses.

## Key Features

- **Per-Character Knowledge Bases**: Each character can have their own separate knowledge base
- **Document Upload & Management**: Upload `.txt` and `.md` files via HTTP API
- **Offline-First**: Uses SQLite FTS5 for fast keyword-based search (no internet required)
- **Automatic Ingestion**: Documents are automatically processed and indexed in the background
- **Context Injection**: Retrieved information is seamlessly injected into conversations
- **Fast Retrieval**: Sub-second retrieval times with BM25 ranking

## Architecture

```
knowledge_base/
  {conf_uid}/               # Per-character directory
    raw/                    # Original uploaded files
    chunks/                 # Processed text chunks
    index/
      kb.db                 # SQLite FTS5 index
    metadata.json           # Document tracking and status
```

## Configuration

### Enable Knowledge Base for a Character

Add the following to your character's configuration file (e.g., `characters/my_character.yaml`):

```yaml
character_config:
  conf_name: "My Character"
  conf_uid: "my_char_001"
  # ... other character settings ...

  # Knowledge Base Configuration
  knowledge_base:
    enabled: true                   # Enable KB for this character
    backend: 'sqlite_fts5'          # Retrieval backend (currently only sqlite_fts5)
    top_k: 3                        # Number of results to retrieve per query
    max_context_chars: 2000         # Maximum characters to inject into prompt
    chunk_size: 500                 # Text chunk size for indexing
    chunk_overlap: 50               # Overlap between chunks
    min_similarity: 0.3             # Minimum similarity score (for future embeddings backend)
```

### Configuration Options Explained

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable/disable KB for this character |
| `backend` | string | `sqlite_fts5` | Retrieval backend: `sqlite_fts5` (keyword) or `embeddings` (semantic, future) |
| `top_k` | integer | `3` | Number of top-ranked chunks to retrieve |
| `max_context_chars` | integer | `2000` | Maximum total characters from retrieved chunks to inject into the LLM prompt |
| `chunk_size` | integer | `500` | Size of text chunks for indexing (in characters) |
| `chunk_overlap` | integer | `50` | Overlap between consecutive chunks to maintain context |
| `min_similarity` | float | `0.3` | Minimum similarity score for results (0.0-1.0, for embeddings backend) |

## API Reference

All KB endpoints are prefixed with `/kb/{conf_uid}`, where `{conf_uid}` is your character's unique identifier.

### 1. Upload Document

Upload a document to a character's knowledge base.

**Endpoint:** `POST /kb/{conf_uid}/upload`

**Query Parameters:**
- `auto_ingest` (boolean, default: `true`): Automatically start ingestion after upload

**Request:**
```bash
curl -X POST "http://localhost:12393/kb/mao_pro_001/upload?auto_ingest=true" \
  -F "file=@document.txt"
```

**Response:**
```json
{
  "success": true,
  "message": "File 'document.txt' uploaded successfully",
  "data": {
    "file_id": "20260120_154532_a1b2c3d4e5f6g7h8",
    "original_filename": "document.txt",
    "stored_filename": "20260120_154532_a1b2c3d4e5f6g7h8.txt",
    "size": 1024,
    "status": "uploaded",
    "ingestion": {
      "task_id": "mao_pro_001:20260120_154532_a1b2c3d4e5f6g7h8",
      "status": "processing"
    }
  }
}
```

### 2. List Documents

List all documents in a character's knowledge base.

**Endpoint:** `GET /kb/{conf_uid}/documents`

**Request:**
```bash
curl "http://localhost:12393/kb/mao_pro_001/documents"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "conf_uid": "mao_pro_001",
    "documents": [
      {
        "file_id": "20260120_154532_a1b2c3d4e5f6g7h8",
        "original_filename": "document.txt",
        "stored_filename": "20260120_154532_a1b2c3d4e5f6g7h8.txt",
        "status": "indexed",
        "size": 1024,
        "timestamp": "20260120_154532"
      }
    ],
    "count": 1
  }
}
```

### 3. Delete Document

Delete a document and remove it from the index.

**Endpoint:** `DELETE /kb/{conf_uid}/documents/{file_id}`

**Request:**
```bash
curl -X DELETE "http://localhost:12393/kb/mao_pro_001/documents/20260120_154532_a1b2c3d4e5f6g7h8"
```

**Response:**
```json
{
  "success": true,
  "message": "Document '20260120_154532_a1b2c3d4e5f6g7h8' deleted successfully"
}
```

### 4. Get KB Statistics

Get statistics about a character's knowledge base.

**Endpoint:** `GET /kb/{conf_uid}/stats`

**Request:**
```bash
curl "http://localhost:12393/kb/mao_pro_001/stats"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "conf_uid": "mao_pro_001",
    "total_documents": 5,
    "total_chunks": 127,
    "db_size_bytes": 65536,
    "by_status": {
      "indexed": 4,
      "processing": 1
    }
  }
}
```

### 5. Rebuild Index

Rebuild the entire knowledge base index (re-processes all documents).

**Endpoint:** `POST /kb/{conf_uid}/rebuild`

**Request:**
```bash
curl -X POST "http://localhost:12393/kb/mao_pro_001/rebuild"
```

**Response:**
```json
{
  "success": true,
  "message": "Index rebuild completed for 'mao_pro_001'"
}
```

### 6. Test Retrieval

Test retrieval with a query (useful for debugging).

**Endpoint:** `POST /kb/{conf_uid}/test-retrieval`

**Request:**
```bash
curl -X POST "http://localhost:12393/kb/mao_pro_001/test-retrieval" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How do I install the application?",
    "top_k": 3,
    "max_chars": 1000
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "query": "How do I install the application?",
    "results": [
      {
        "chunk_id": "20260120_154532_a1b2c3d4e5f6g7h8_0",
        "file_id": "20260120_154532_a1b2c3d4e5f6g7h8",
        "filename": "installation.txt",
        "chunk_index": 0,
        "text": "Installation requires Python 3.10+ and uv...",
        "rank": -0.85,
        "truncated": false
      }
    ],
    "count": 1,
    "formatted_context": "[Retrieved Knowledge Base Context]\n1. Installation requires Python 3.10+ and uv... (Source: installation.txt)\n[End of Retrieved Context]"
  }
}
```

## Usage Examples

### Example 1: Upload and Use KB in Conversation

```bash
# 1. Upload a document about your project
curl -X POST "http://localhost:12393/kb/my_char_001/upload?auto_ingest=true" \
  -F "file=@project_docs.txt"

# 2. Wait a few seconds for ingestion to complete

# 3. Chat with your character - KB context will be automatically retrieved!
# Just use the web interface or WebSocket API as normal
```

### Example 2: Python Script to Bulk Upload

```python
import httpx
import asyncio
from pathlib import Path

async def bulk_upload(conf_uid: str, docs_dir: Path):
    """Upload all .txt and .md files from a directory"""
    async with httpx.AsyncClient(timeout=30.0) as client:
        for file_path in docs_dir.glob("*.txt"):
            print(f"Uploading {file_path.name}...")
            
            with open(file_path, "rb") as f:
                files = {"file": (file_path.name, f, "text/plain")}
                response = await client.post(
                    f"http://localhost:12393/kb/{conf_uid}/upload?auto_ingest=true",
                    files=files
                )
                
                if response.status_code == 200:
                    print(f"  ✅ Success!")
                else:
                    print(f"  ❌ Failed: {response.status_code}")

# Usage
asyncio.run(bulk_upload("my_char_001", Path("./docs")))
```

### Example 3: Check Ingestion Status

```python
import httpx
import asyncio

async def wait_for_ingestion(conf_uid: str):
    """Wait until all documents are indexed"""
    async with httpx.AsyncClient() as client:
        while True:
            response = await client.get(
                f"http://localhost:12393/kb/{conf_uid}/stats"
            )
            stats = response.json()["data"]
            
            by_status = stats.get("by_status", {})
            processing = by_status.get("processing", 0)
            
            if processing == 0:
                print("✅ All documents indexed!")
                break
            
            print(f"⏳ Still processing {processing} document(s)...")
            await asyncio.sleep(2)

asyncio.run(wait_for_ingestion("my_char_001"))
```

## How It Works

### Retrieval Flow

1. **User sends a message**: "What is the capital of France?"
2. **KB retrieval** (if enabled):
   - Query: "What is the capital of France?"
   - SQLite FTS5 searches indexed chunks
   - Returns top 3 most relevant chunks (BM25 ranking)
3. **Context injection**:
   ```
   [Retrieved Knowledge Base Context]
   1. Paris is the capital and largest city of France... (Source: geography.txt)
   2. The city of Paris is located in northern France... (Source: cities.txt)
   [End of Retrieved Context]
   
   Human: What is the capital of France?
   ```
4. **LLM responds** with context-aware answer

### Document Processing Pipeline

1. **Upload**: File saved to `knowledge_base/{conf_uid}/raw/`
2. **Background Task Started**:
   - Extract text content
   - Split into chunks (500 chars with 50 char overlap)
   - Save chunks to `knowledge_base/{conf_uid}/chunks/`
   - Index chunks in SQLite FTS5
3. **Status Updates**: `uploaded` → `processing` → `indexed` (or `error`)

## Supported File Formats

Currently supported:
- `.txt` - Plain text files
- `.md` - Markdown files

**Future support planned:**
- `.pdf` - PDF documents
- `.docx` - Microsoft Word documents
- `.html` - HTML files

## Performance Considerations

- **Retrieval latency**: ~10-50ms for typical queries
- **Chunk size**: Smaller chunks = more precise retrieval but more chunks to index
- **Top-k**: Higher values = more context but may exceed token limits
- **Max context chars**: Balance between giving enough context and staying within LLM limits

## Troubleshooting

### Documents stuck in "processing" status

Check server logs for errors:
```bash
tail -f logs/debug_*.log | grep KB
```

Try rebuilding the index:
```bash
curl -X POST "http://localhost:12393/kb/{conf_uid}/rebuild"
```

### No results returned during retrieval

1. Check if documents are indexed:
   ```bash
   curl "http://localhost:12393/kb/{conf_uid}/stats"
   ```

2. Test retrieval directly:
   ```bash
   curl -X POST "http://localhost:12393/kb/{conf_uid}/test-retrieval" \
     -H "Content-Type: application/json" \
     -d '{"query": "test", "top_k": 5}'
   ```

3. Verify KB is enabled in character config

### Large files causing timeout

- Break large files into smaller chunks before uploading
- Increase chunk_size in config to reduce number of chunks
- Process files sequentially rather than in parallel

## Best Practices

1. **Organize documents by topic**: Upload related documents together
2. **Use descriptive filenames**: Helps track what's in the KB
3. **Keep documents focused**: Smaller, topic-specific docs work better than large mixed-content files
4. **Test retrieval**: Use the test-retrieval endpoint to verify your documents are indexed correctly
5. **Monitor KB size**: Check stats regularly to avoid excessive storage use
6. **Clean up outdated docs**: Delete old documents when information becomes stale

## Future Enhancements

- **Embeddings backend**: Semantic search using vector embeddings
- **Multi-language support**: Language-specific tokenization
- **Advanced chunking**: Markdown-aware chunking, code block preservation
- **File format support**: PDF, DOCX, HTML parsing
- **Metadata filtering**: Filter by document date, author, tags
- **Web scraping**: Direct URL ingestion
- **Incremental updates**: Update specific chunks without full re-indexing

## Testing

Run the included test script:

```bash
# Using default conf_uid
uv run python test_knowledge_base.py

# Using custom conf_uid
uv run python test_knowledge_base.py my_character_uid
```

The test script will:
1. Upload a test document
2. Wait for ingestion
3. Check stats
4. Test retrieval with sample queries
5. List documents
6. Clean up (delete test document)

## License & Attribution

The Knowledge Base feature is part of Open-LLM-VTuber and follows the same MIT license.

---

For more information, visit: https://github.com/t41372/Open-LLM-VTuber
