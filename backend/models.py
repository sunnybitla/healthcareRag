import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from backend.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="Registered User", nullable=False)  # "Guest", "Registered User", "Admin"

    # Relationships
    sessions = relationship("ChatSession", back_populates="user", cascade="all, delete-orphan")


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    file_size = Column(Integer, nullable=False)  # in bytes
    uploaded_by = Column(String, nullable=False)  # username of uploader
    upload_time = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    status = Column(String, default="Pending", nullable=False)  # "Pending", "Processing", "Indexed", "Error"

    # Relationships
    chunks = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)

    # Relationships
    document = relationship("Document", back_populates="chunks")


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(String, primary_key=True, index=True)  # UUID or string identifier
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User", back_populates="sessions")
    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False)
    sender = Column(String, nullable=False)  # "user" or "assistant"
    content = Column(Text, nullable=False)
    citations = Column(Text, nullable=True)  # JSON-encoded list of cited sources
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)

    # Relationships
    session = relationship("ChatSession", back_populates="messages")


class AnalyticsEvent(Base):
    __tablename__ = "analytics_events"

    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String, nullable=False)  # "login", "register", "document_upload", "chat_query", "semantic_search"
    username = Column(String, nullable=False)
    metadata_json = Column(Text, nullable=True)  # JSON-encoded dict of extra parameters (response time, etc.)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
