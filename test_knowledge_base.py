"""
Test script for Knowledge Base functionality.

This script demonstrates uploading documents, ingesting them,
and testing retrieval from the knowledge base.
"""

import asyncio
import httpx
import sys

# Configuration
BASE_URL = "http://localhost:12393"
CONF_UID = "mao_pro_001"  # Change to your character's conf_uid
TEST_DOCUMENT = """
Open-LLM-VTuber is a voice-based AI assistant application.

Key Features:
- Low-latency voice interaction with sub-500ms response times
- Live2D animated character display
- Support for multiple LLM providers (OpenAI, Claude, Ollama, etc.)
- Fully offline capability
- Cross-platform support (Windows, macOS, Linux)

Technical Stack:
- Backend: FastAPI with async/await
- LLM Integration: Multiple providers supported
- Voice: ASR (Automatic Speech Recognition) and TTS (Text-to-Speech)
- Frontend: React-based web interface

The application is designed for developers who want to create interactive
AI assistants with animated characters. It supports conversation memory,
daily life features, and knowledge base retrieval.

Installation requires Python 3.10+ and uses uv for dependency management.
"""


async def test_kb_workflow():
    """Test the complete KB workflow: upload -> ingest -> retrieve"""

    async with httpx.AsyncClient(timeout=30.0) as client:
        print(f"🧪 Testing Knowledge Base for character: {CONF_UID}\n")

        # Step 1: Upload a document
        print("📤 Step 1: Uploading test document...")
        files = {"file": ("test_doc.txt", TEST_DOCUMENT.encode(), "text/plain")}
        response = await client.post(
            f"{BASE_URL}/kb/{CONF_UID}/upload?auto_ingest=true", files=files
        )

        if response.status_code != 200:
            print(f"❌ Upload failed: {response.status_code} - {response.text}")
            return False

        result = response.json()
        print("✅ Upload successful!")
        print(f"   File ID: {result['data']['file_id']}")
        print(f"   Status: {result['data']['status']}")

        file_id = result["data"]["file_id"]

        # Wait for ingestion to complete
        print("\n⏳ Step 2: Waiting for ingestion to complete...")
        await asyncio.sleep(3)  # Give it time to process

        # Step 3: Check stats
        print("\n📊 Step 3: Checking KB statistics...")
        response = await client.get(f"{BASE_URL}/kb/{CONF_UID}/stats")

        if response.status_code != 200:
            print(f"❌ Stats fetch failed: {response.status_code}")
            return False

        stats = response.json()["data"]
        print("✅ KB Stats:")
        print(f"   Total documents: {stats['total_documents']}")
        print(f"   Total chunks: {stats['total_chunks']}")
        print(f"   DB size: {stats['db_size_bytes']} bytes")

        # Step 4: Test retrieval
        print("\n🔍 Step 4: Testing retrieval...")
        queries = [
            "What is Open-LLM-VTuber?",
            "What are the key features?",
            "What technology stack is used?",
        ]

        for query in queries:
            print(f"\n   Query: '{query}'")
            response = await client.post(
                f"{BASE_URL}/kb/{CONF_UID}/test-retrieval",
                json={"query": query, "top_k": 2, "max_chars": 500},
            )

            if response.status_code != 200:
                print(f"   ❌ Retrieval failed: {response.status_code}")
                print(f"   Error details: {response.text}")
                continue

            result = response.json()["data"]
            print(f"   ✅ Found {result['count']} results:")

            for i, res in enumerate(result["results"], 1):
                text_preview = (
                    res["text"][:100] + "..." if len(res["text"]) > 100 else res["text"]
                )
                print(f"      {i}. {text_preview}")

        # Step 5: List documents
        print("\n\n📋 Step 5: Listing all documents...")
        response = await client.get(f"{BASE_URL}/kb/{CONF_UID}/documents")

        if response.status_code != 200:
            print(f"❌ List failed: {response.status_code}")
            return False

        docs = response.json()["data"]["documents"]
        print(f"✅ Found {len(docs)} document(s):")
        for doc in docs:
            print(
                f"   - {doc['original_filename']} (ID: {doc['file_id']}, Status: {doc['status']})"
            )

        # Step 6: Cleanup (optional)
        print("\n\n🗑️  Step 6: Cleanup - Delete test document? (y/n)")
        # Auto-cleanup in test
        print("   Auto-cleaning up...")
        response = await client.delete(f"{BASE_URL}/kb/{CONF_UID}/documents/{file_id}")

        if response.status_code == 200:
            print("   ✅ Document deleted successfully")
        else:
            print(f"   ❌ Delete failed: {response.status_code}")

        print("\n✅ All tests completed successfully!")
        return True


async def quick_upload_test():
    """Quick test to just upload a file"""
    async with httpx.AsyncClient(timeout=30.0) as client:
        print(f"📤 Quick upload test for: {CONF_UID}")

        files = {
            "file": ("quick_test.txt", b"This is a quick test document.", "text/plain")
        }
        response = await client.post(
            f"{BASE_URL}/kb/{CONF_UID}/upload?auto_ingest=true", files=files
        )

        if response.status_code == 200:
            result = response.json()
            print(f"✅ Upload successful! File ID: {result['data']['file_id']}")
        else:
            print(f"❌ Upload failed: {response.status_code} - {response.text}")


if __name__ == "__main__":
    print("=" * 60)
    print("Knowledge Base Test Script")
    print("=" * 60)
    print()

    if len(sys.argv) > 1:
        CONF_UID = sys.argv[1]
        print(f"Using conf_uid from argument: {CONF_UID}\n")

    try:
        asyncio.run(test_kb_workflow())
    except KeyboardInterrupt:
        print("\n\n⚠️  Test interrupted by user")
    except httpx.ConnectError:
        print(
            "\n❌ Could not connect to server. Make sure the server is running at:",
            BASE_URL,
        )
    except Exception as e:
        print(f"\n❌ Test failed with error: {e}")
        import traceback

        traceback.print_exc()
