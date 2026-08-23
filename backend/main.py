import os
import json
import uuid
import time
import datetime
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel

from backend.config import IS_MOCK_MODE, BASE_DIR
from backend.database import engine, Base, get_db
from backend.models import User, Document, DocumentChunk, ChatSession, ChatMessage, AnalyticsEvent
from backend.auth import (
    get_password_hash,
    verify_password,
    create_access_token,
    get_current_user,
    RoleChecker
)
from backend.rag import extract_text_from_file, index_document, delete_document_from_index, search_chunks, generate_rag_answer, init_qdrant, COLLECTION_NAME

# Initialize database tables and vector store collections
Base.metadata.create_all(bind=engine)
init_qdrant()

app = FastAPI(title="Healthcare RAG Assistant API", version="1.0.0")

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For development; refine for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {
        "status": "online",
        "message": "Healthcare RAG Assistant API is running.",
        "docs_url": "/docs",
        "redoc_url": "/redoc",
        "frontend_url": "http://localhost:3000"
    }

# Helper function to log analytics events
def log_event(db: Session, event_type: str, username: str, metadata: dict = None):
    try:
        event = AnalyticsEvent(
            event_type=event_type,
            username=username,
            metadata_json=json.dumps(metadata) if metadata else None,
            timestamp=datetime.datetime.utcnow()
        )
        db.add(event)
        db.commit()
    except Exception as e:
        print(f"Failed to log analytics event: {e}")

# Pydantic Schemas
class RegisterRequest(BaseModel):
    username: str
    password: str
    role: Optional[str] = "Registered User"  # Defaults to "Registered User" (Read-only docs, Dialogue history, Search)

class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    username: str
    role: str

class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    message: str

class ChatMessageResponse(BaseModel):
    id: int
    sender: str
    content: str
    citations: Optional[List[dict]] = None
    timestamp: str

class ChatSessionResponse(BaseModel):
    id: str
    title: str
    created_at: str
    messages: List[ChatMessageResponse]

# Auth Endpoints
@app.post("/api/register", response_model=TokenResponse)
@app.post("/register", response_model=TokenResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    role = req.role if req.role in ["Guest", "Registered User", "Admin"] else "Registered User"
        
    db_user = db.query(User).filter(User.username == req.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered.")
        
    hashed_pwd = get_password_hash(req.password)
    new_user = User(username=req.username, password_hash=hashed_pwd, role=role)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    # Log analytics
    log_event(db, "register", new_user.username, {"role": new_user.role})
    
    # Generate token
    token = create_access_token({"sub": new_user.username})
    return {
        "access_token": token,
        "token_type": "bearer",
        "username": new_user.username,
        "role": new_user.role
    }

@app.post("/api/login", response_model=TokenResponse)
@app.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    # Support JSON request payload
    user = db.query(User).filter(User.username == req.username).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect username or password.")
        
    # Log analytics
    log_event(db, "login", user.username)
    
    token = create_access_token({"sub": user.username})
    return {
        "access_token": token,
        "token_type": "bearer",
        "username": user.username,
        "role": user.role
    }

# OAuth2 Password Flow support (convenient for API docs / testing)
@app.post("/api/login/form", response_model=TokenResponse)
def login_form(username: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect username or password.")
        
    log_event(db, "login", user.username)
    
    token = create_access_token({"sub": user.username})
    return {
        "access_token": token,
        "token_type": "bearer",
        "username": user.username,
        "role": user.role
    }

# Document Upload & Ingestion Endpoints (Admin only)
@app.post("/api/upload")
def upload_document(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(RoleChecker(["Admin"]))
):
    start_time = time.time()
    
    # Validate file type
    _, ext = os.path.splitext(file.filename.lower())
    if ext not in [".pdf", ".txt"]:
        raise HTTPException(status_code=400, detail="Unsupported file format. Only PDF and TXT allowed.")
        
    # Create Document record
    # Write file to a local temporary workspace path to process
    temp_dir = os.path.join(BASE_DIR, "temp_uploads")
    os.makedirs(temp_dir, exist_ok=True)
    temp_path = os.path.join(temp_dir, f"{uuid.uuid4()}{ext}")
    
    try:
        # Read contents
        contents = file.file.read()
        file_size = len(contents)
        
        with open(temp_path, "wb") as f:
            f.write(contents)
            
        # Create database record
        doc = Document(
            filename=file.filename,
            file_size=file_size,
            uploaded_by=current_user.username,
            status="Processing"
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)
        
        # 2. Process & Index
        extracted_text = extract_text_from_file(temp_path)
        num_chunks = index_document(db, doc.id, doc.filename, extracted_text)
        
        # 3. Update status
        doc.status = "Indexed"
        db.commit()
        
        processing_time = time.time() - start_time
        log_event(db, "document_upload", current_user.username, {
            "filename": file.filename,
            "file_size": file_size,
            "chunks": num_chunks,
            "processing_time": processing_time
        })
        
        return {
            "message": "File uploaded and processed successfully",
            "document_id": doc.id,
            "filename": doc.filename,
            "chunks": num_chunks,
            "processing_time_sec": round(processing_time, 2)
        }
        
    except Exception as e:
        # Log failure
        db.rollback()
        log_event(db, "document_upload_failed", current_user.username, {
            "filename": file.filename,
            "error": str(e)
        })
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {str(e)}")
    finally:
        # Cleanup temp file
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass

@app.get("/api/documents")
def get_documents(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Guest and Registered users can see document list (metadata), Admins can see all + actions
    docs = db.query(Document).order_by(Document.upload_time.desc()).all()
    return [{
        "id": doc.id,
        "filename": doc.filename,
        "file_size": doc.file_size,
        "uploaded_by": doc.uploaded_by,
        "upload_time": doc.upload_time.isoformat(),
        "status": doc.status
    } for doc in docs]

@app.delete("/api/documents/{doc_id}")
def delete_document(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(RoleChecker(["Admin"]))
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
        
    try:
        delete_document_from_index(db, doc_id)
        db.delete(doc)
        db.commit()
        
        log_event(db, "document_delete", current_user.username, {"document_id": doc_id, "filename": doc.filename})
        return {"message": f"Document {doc.filename} deleted successfully."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete document: {str(e)}")

# Semantic Search (Registered Users & Admins)
@app.get("/api/search")
def run_semantic_search(
    q: str,
    limit: Optional[int] = 5,
    db: Session = Depends(get_db),
    current_user: User = Depends(RoleChecker(["Registered User", "Admin"]))
):
    start_time = time.time()
    if not q.strip():
        return []
        
    results = search_chunks(q, db, limit=limit)
    response_time = time.time() - start_time
    
    log_event(db, "semantic_search", current_user.username, {
        "query": q,
        "results_count": len(results),
        "response_time": response_time
    })
    
    return results

# Conversational Chat Endpoints
@app.post("/api/chat")
def handle_chat_message(
    req: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    start_time = time.time()
    
    # Guest role cannot save chat sessions, but can still get a response (Stateless)
    is_guest = current_user.role == "Guest"
    
    # Find or create session
    session_id = req.session_id
    if not is_guest:
        if not session_id:
            session_id = str(uuid.uuid4())
            # Create session in DB
            title = req.message[:40] + ("..." if len(req.message) > 40 else "")
            session = ChatSession(id=session_id, user_id=current_user.id, title=title)
            db.add(session)
            db.commit()
        else:
            session = db.query(ChatSession).filter(ChatSession.id == session_id, ChatSession.user_id == current_user.id).first()
            if not session:
                raise HTTPException(status_code=404, detail="Chat session not found.")
                
        # Save user message
        user_msg = ChatMessage(
            session_id=session_id,
            sender="user",
            content=req.message
        )
        db.add(user_msg)
        db.commit()
    else:
        if not session_id:
            session_id = "guest-session"
            
    # 1. Retrieve chunks matching user message
    matched_chunks = search_chunks(req.message, db, limit=4)
    
    # 2. Generate answer
    ai_answer, citations = generate_rag_answer(req.message, matched_chunks)
    
    # Save AI message in database
    ai_msg_id = -1
    if not is_guest:
        ai_msg = ChatMessage(
            session_id=session_id,
            sender="assistant",
            content=ai_answer,
            citations=json.dumps(citations)
        )
        db.add(ai_msg)
        db.commit()
        db.refresh(ai_msg)
        ai_msg_id = ai_msg.id
        
    response_time = time.time() - start_time
    log_event(db, "chat_query", current_user.username, {
        "query": req.message,
        "session_id": session_id,
        "chunks_retrieved": len(matched_chunks),
        "response_time": response_time,
        "is_mock": IS_MOCK_MODE
    })
    
    return {
        "session_id": session_id,
        "message": {
            "id": ai_msg_id if not is_guest else int(time.time()),
            "sender": "assistant",
            "content": ai_answer,
            "citations": citations,
            "timestamp": datetime.datetime.utcnow().isoformat()
        }
    }

@app.get("/api/history", response_model=List[ChatSessionResponse])
def get_chat_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(RoleChecker(["Registered User", "Admin"]))
):
    sessions = db.query(ChatSession).filter(ChatSession.user_id == current_user.id).order_by(ChatSession.created_at.desc()).all()
    
    response = []
    for s in sessions:
        msgs = db.query(ChatMessage).filter(ChatMessage.session_id == s.id).order_by(ChatMessage.timestamp.asc()).all()
        parsed_msgs = []
        for m in msgs:
            citations_list = None
            if m.citations:
                try:
                    citations_list = json.loads(m.citations)
                except Exception:
                    pass
            parsed_msgs.append({
                "id": m.id,
                "sender": m.sender,
                "content": m.content,
                "citations": citations_list,
                "timestamp": m.timestamp.isoformat()
            })
            
        response.append({
            "id": s.id,
            "title": s.title,
            "created_at": s.created_at.isoformat(),
            "messages": parsed_msgs
        })
    return response

# System Status & Analytics (Admin only)
@app.get("/api/analytics")
def get_system_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(RoleChecker(["Admin"]))
):
    total_docs = db.query(Document).count()
    total_chunks = db.query(DocumentChunk).count()
    total_users = db.query(User).count()
    
    # Calculate average query response time
    chat_events = db.query(AnalyticsEvent).filter(AnalyticsEvent.event_type == "chat_query").all()
    response_times = []
    for event in chat_events:
        if event.metadata_json:
            try:
                meta = json.loads(event.metadata_json)
                if "response_time" in meta:
                    response_times.append(meta["response_time"])
            except Exception:
                pass
    avg_response_time = round(sum(response_times) / len(response_times), 2) if response_times else 0.0
    
    # Activity logs
    recent_events = db.query(AnalyticsEvent).order_by(AnalyticsEvent.timestamp.desc()).limit(15).all()
    event_list = []
    for e in recent_events:
        meta_dict = None
        if e.metadata_json:
            try:
                meta_dict = json.loads(e.metadata_json)
            except Exception:
                pass
        event_list.append({
            "id": e.id,
            "event_type": e.event_type,
            "username": e.username,
            "metadata": meta_dict,
            "timestamp": e.timestamp.isoformat()
        })
        
    # Popular queries
    popular_queries = []
    for e in chat_events:
        if e.metadata_json:
            try:
                meta = json.loads(e.metadata_json)
                if "query" in meta:
                    popular_queries.append(meta["query"])
            except Exception:
                pass
    query_freq = {}
    for q in popular_queries:
        query_freq[q] = query_freq.get(q, 0) + 1
    sorted_queries = sorted(query_freq.items(), key=lambda x: x[1], reverse=True)[:5]
    
    # Vector DB status
    vector_status = {
        "status": "Online" if not IS_MOCK_MODE else "Mock Mode",
        "api_key_configured": not IS_MOCK_MODE,
        "collection": COLLECTION_NAME if not IS_MOCK_MODE else None
    }
    
    return {
        "metrics": {
            "total_documents": total_docs,
            "total_chunks": total_chunks,
            "total_users": total_users,
            "average_response_time_sec": avg_response_time,
            "total_queries": len(chat_events)
        },
        "system_status": vector_status,
        "recent_activities": event_list,
        "top_queries": [{"query": item[0], "count": item[1]} for item in sorted_queries]
    }
