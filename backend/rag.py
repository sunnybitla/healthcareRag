import json
import os
import pypdf
from typing import List, Dict, Any, Tuple
from sqlalchemy.orm import Session
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, PointIdsList

from backend.config import GEMINI_API_KEY, IS_MOCK_MODE, QDRANT_PATH
from backend.models import Document, DocumentChunk

# Initialize Qdrant Client (local disk storage or in-memory)
if QDRANT_PATH == ":memory:":
    qdrant_client = QdrantClient(location=":memory:")
else:
    qdrant_client = QdrantClient(path=QDRANT_PATH)
COLLECTION_NAME = "healthcare_documents"

def init_qdrant():
    """Ensure the Qdrant collection is created if not in mock mode."""
    if IS_MOCK_MODE:
        return
    try:
        collections = qdrant_client.get_collections().collections
        collection_names = [col.name for col in collections]
        if COLLECTION_NAME not in collection_names:
            qdrant_client.create_collection(
                collection_name=COLLECTION_NAME,
                vectors_config=VectorParams(size=768, distance=Distance.COSINE)
            )
    except Exception as e:
        print(f"Error initializing Qdrant collection: {e}")

def extract_text_from_file(file_path: str) -> str:
    """Extracts text from PDF or TXT files."""
    _, ext = os.path.splitext(file_path.lower())
    if ext == ".pdf":
        try:
            reader = pypdf.PdfReader(file_path)
            text = ""
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
            return text
        except Exception as e:
            raise ValueError(f"Failed to read PDF: {str(e)}")
    else:
        # Default to plain text
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read()
        except Exception as e:
            raise ValueError(f"Failed to read file: {str(e)}")

def chunk_text(text: str, chunk_size: int = 1000, chunk_overlap: int = 200) -> List[str]:
    """Splits text into chunks of chunk_size with chunk_overlap."""
    chunks = []
    if not text:
        return chunks
    
    start = 0
    text_len = len(text)
    
    while start < text_len:
        end = min(start + chunk_size, text_len)
        if end < text_len:
            # Try to split at a space to prevent cutting words
            last_space = text.rfind(" ", end - chunk_overlap, end)
            if last_space != -1 and last_space > start:
                end = last_space
        
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        
        start = end - chunk_overlap
        if start >= text_len or end >= text_len:
            break
            
    return chunks

import time
import re

def get_gemini_embeddings(texts: List[str]) -> List[List[float]]:
    """Generates gemini-embedding-001 embeddings via the official google-genai SDK with automatic retry, backoff, and fallback."""
    if IS_MOCK_MODE or not GEMINI_API_KEY:
        return [[0.0] * 768 for _ in texts]
        
    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=GEMINI_API_KEY)
    except Exception as e:
        print(f"Failed to initialize Gemini Client: {e}. Using fallback embeddings.")
        return [[0.0] * 768 for _ in texts]
    
    embeddings = []
    batch_size = 25  # Smaller batch size to prevent payload / quota spikes
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i+batch_size]
        max_retries = 3
        batch_embeddings = None
        
        for attempt in range(max_retries):
            try:
                response = client.models.embed_content(
                    model="gemini-embedding-001",
                    contents=batch,
                    config=types.EmbedContentConfig(output_dimensionality=768)
                )
                batch_embeddings = [emb.values for emb in response.embeddings]
                break
            except Exception as e:
                err_msg = str(e)
                if "429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg:
                    match = re.search(r'retry in (\d+(?:\.\d+)?)s', err_msg) or re.search(r"retryDelay':\s*'(\d+)s", err_msg)
                    wait_time = float(match.group(1)) + 1 if match else (2 ** (attempt + 1) * 2)
                    wait_time = min(wait_time, 15.0)
                    print(f"Gemini API rate limit (429) on batch {i//batch_size + 1}. Retrying in {wait_time:.1f}s (Attempt {attempt+1}/{max_retries})...")
                    time.sleep(wait_time)
                else:
                    print(f"Gemini embedding batch error: {e}")
                    break
                    
        if batch_embeddings is not None:
            embeddings.extend(batch_embeddings)
        else:
            print(f"Gemini embedding quota reached or unavailable. Using fallback vectors for batch {i//batch_size + 1}.")
            embeddings.extend([[0.0] * 768 for _ in batch])
            
        if i + batch_size < len(texts):
            time.sleep(0.3)
            
    return embeddings

def index_document(db: Session, doc_id: int, filename: str, text: str) -> int:
    """Chunks, commits to DB, and indexes a document in Qdrant (if online)."""
    chunks = chunk_text(text)
    if not chunks:
        # Create a single empty chunk if there's no text
        chunks = ["(Empty Document)"]
        
    # 1. Store chunks in DB
    db_chunks = []
    for idx, content in enumerate(chunks):
        chunk = DocumentChunk(document_id=doc_id, chunk_index=idx, content=content)
        db.add(chunk)
        db_chunks.append(chunk)
    
    db.commit()  # Commit to assign chunk.id
    
    # 2. Vector Indexing
    if not IS_MOCK_MODE:
        try:
            init_qdrant()
            chunk_contents = [c.content for c in db_chunks]
            embeddings = get_gemini_embeddings(chunk_contents)
            
            points = []
            for idx, chunk in enumerate(db_chunks):
                points.append(PointStruct(
                    id=chunk.id,
                    vector=embeddings[idx],
                    payload={
                        "document_id": doc_id,
                        "chunk_index": chunk.chunk_index,
                        "filename": filename,
                        "content": chunk.content
                    }
                ))
            
            qdrant_client.upsert(
                collection_name=COLLECTION_NAME,
                points=points
            )
        except Exception as e:
            print(f"Warning: Vector indexing issue ({e}). Document successfully stored in SQLite for keyword retrieval.")
            
    return len(chunks)

def delete_document_from_index(db: Session, doc_id: int):
    """Deletes document chunks from DB and Qdrant index."""
    # Retrieve chunk IDs to delete from Qdrant
    chunks = db.query(DocumentChunk).filter(DocumentChunk.document_id == doc_id).all()
    chunk_ids = [c.id for c in chunks]
    
    # Delete from Qdrant
    if not IS_MOCK_MODE and chunk_ids:
        try:
            qdrant_client.delete(
                collection_name=COLLECTION_NAME,
                points_selector=PointIdsList(points=chunk_ids)
            )
        except Exception as e:
            print(f"Error deleting points from Qdrant: {e}")
            
    # Delete chunks from SQLite
    db.query(DocumentChunk).filter(DocumentChunk.document_id == doc_id).delete()
    db.commit()

def search_chunks(query: str, db: Session, limit: int = 5) -> List[Dict[str, Any]]:
    """Retrieves most relevant chunks using semantic search (Qdrant) or keyword search (fallback)."""
    if not IS_MOCK_MODE:
        try:
            # Embed search query
            query_vector = get_gemini_embeddings([query])[0]
            
            # Search Qdrant
            results = qdrant_client.search(
                collection_name=COLLECTION_NAME,
                query_vector=query_vector,
                limit=limit
            )
            
            matched_chunks = []
            for res in results:
                matched_chunks.append({
                    "chunk_id": res.id,
                    "document_id": res.payload.get("document_id"),
                    "filename": res.payload.get("filename"),
                    "content": res.payload.get("content"),
                    "score": res.score
                })
            return matched_chunks
        except Exception as e:
            print(f"Qdrant search failed, falling back to keyword search: {e}")
            # Fall through to keyword search
            
    # Keyword Search (Fallback / Mock Mode)
    words = [w.lower() for w in query.split() if len(w) > 2]
    chunks = db.query(DocumentChunk).all()
    scored_chunks = []
    
    for chunk in chunks:
        score = 0
        content_lower = chunk.content.lower()
        
        # Exact sentence matching gets a boost
        if query.lower() in content_lower:
            score += 15
            
        for word in words:
            if word in content_lower:
                score += content_lower.count(word) * 2
                
        if score > 0 or not words:
            # Join document info
            doc = db.query(Document).filter(Document.id == chunk.document_id).first()
            filename = doc.filename if doc else "Unknown"
            
            scored_chunks.append({
                "chunk_id": chunk.id,
                "document_id": chunk.document_id,
                "filename": filename,
                "content": chunk.content,
                "score": score
            })
            
    # Sort by score descending
    scored_chunks.sort(key=lambda x: x["score"], reverse=True)
    
    # Normalize score for representation
    max_score = max([x["score"] for x in scored_chunks]) if scored_chunks else 1
    for item in scored_chunks:
        item["score"] = min(0.95, (item["score"] / max_score) * 0.8 + 0.1) if max_score > 0 else 0.5
        
    return scored_chunks[:limit]

def generate_rag_answer(query: str, chunks: List[Dict[str, Any]]) -> Tuple[str, List[Dict[str, Any]]]:
    """Generates the RAG answer with inline citations."""
    if not chunks:
        disclaimer = "\n\n*Educational purpose only. Does not replace professional medical advice.*"
        return "I could not find any relevant information in the uploaded medical guidelines or documents. Please upload clinical materials or ask a different question." + disclaimer, []
        
    # Format context for generator
    context_str = ""
    citations = []
    for idx, chunk in enumerate(chunks):
        citation_num = idx + 1
        context_str += f"--- Source [{citation_num}] (File: {chunk['filename']}) ---\n{chunk['content']}\n\n"
        citations.append({
            "num": citation_num,
            "filename": chunk["filename"],
            "content": chunk["content"]
        })
        
    if not IS_MOCK_MODE and GEMINI_API_KEY:
        max_gen_retries = 2
        for attempt in range(max_gen_retries):
            try:
                from google import genai
                client = genai.Client(api_key=GEMINI_API_KEY)
                
                prompt = f"""
You are a highly qualified Healthcare Knowledge Retrieval AI Assistant designed for clinicians, nurses, and medical staff. 
Your goal is to answer the user's medical query objectively using ONLY the provided reference documents below. 

Guidelines:
1. Formulate a comprehensive, evidence-based answer utilizing the details in the text sources.
2. You MUST cite your source facts inline using brackets like [1], [2], etc., matching the exact Source numbers provided in the context.
3. Be professional, direct, and concise. Avoid introductory conversational fluff.
4. If the references do not contain enough facts to answer the question, state clearly that the provided documents do not contain this information. Do not invent facts.
5. End your response with a strict medical disclaimer: "DISCLAIMER: This information is derived from uploaded guidelines for educational/informational purposes only. It does not constitute medical diagnosis, treatment, or clinical decisions."

Context Reference Materials:
{context_str}

User Question:
{query}
"""
                response = client.models.generate_content(
                    model="gemini-flash-latest",
                    contents=prompt
                )
                return response.text, citations
            except Exception as e:
                err_msg = str(e)
                print(f"Gemini API generation failed (Attempt {attempt+1}/{max_gen_retries}): {e}")
                if ("429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg) and attempt < max_gen_retries - 1:
                    time.sleep(3)
                else:
                    break
            
    # Mock Generation Engine (Offline / Quota Fallback)
    # Build a simulated professional response based on chunk highlights
    answer = "### Healthcare RAG Summary (Offline / Fallback Mode)\n\n"
    answer += "Based on the retrieved clinical documentation, here are the key findings:\n\n"
    
    # Extract lines/sentences that contain search words or have high relevance
    for idx, chunk in enumerate(chunks[:3]):
        citation_num = idx + 1
        content_lines = [line.strip() for line in chunk["content"].split("\n") if len(line.strip()) > 30]
        snippet = " | ".join(content_lines[:2]) if content_lines else chunk["content"][:200]
        answer += f"- **From {chunk['filename']}**: \"{snippet}...\" [{citation_num}]\n"
        
    answer += f"\n*Notice: The system is operating in Offline / Fallback mode due to Gemini API rate limits or offline configuration. Retrieved content from your documents is accurately cited above.*"
    answer += "\n\n**DISCLAIMER**: This information is derived from uploaded guidelines for educational/informational purposes only. It does not constitute medical diagnosis, treatment, or clinical decisions."
    
    return answer, citations
