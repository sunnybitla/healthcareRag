import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
test_db_path = os.path.abspath(os.path.join(BASE_DIR, "test_rag.db")).replace('\\', '/')

# Set environment variables for testing before loading config
os.environ["DATABASE_URL"] = f"sqlite:///{test_db_path}"
os.environ["GEMINI_API_KEY"] = ""  # Force mock mode for testing
os.environ["QDRANT_PATH"] = ":memory:"  # In-memory vector store for tests

from backend.database import Base, get_db
from backend.main import app

# Create a test database
SQLALCHEMY_DATABASE_URL = f"sqlite:///{test_db_path}"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Override database dependency in FastAPI app
def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)

@pytest.fixture(scope="module", autouse=True)
def setup_db():
    # Clean up any leftover database file before starting
    test_db_file = os.path.join(BASE_DIR, "test_rag.db")
    if os.path.exists(test_db_file):
        try:
            os.remove(test_db_file)
        except Exception:
            pass
    # Create tables
    Base.metadata.create_all(bind=engine)
    yield
    # Drop tables
    Base.metadata.drop_all(bind=engine)
    if os.path.exists(test_db_file):
        try:
            os.remove(test_db_file)
        except Exception:
            pass

def test_user_flow():
    # 1. Register Guest User
    response = client.post(
        "/api/register",
        json={"username": "guest_user", "password": "password123", "role": "Guest"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["username"] == "guest_user"
    assert data["role"] == "Guest"
    
    # 2. Register Admin User
    response = client.post(
        "/api/register",
        json={"username": "admin_user", "password": "adminpassword", "role": "Admin"}
    )
    assert response.status_code == 200
    admin_data = response.json()
    admin_token = admin_data["access_token"]
    
    # 3. Login
    response = client.post(
        "/api/login",
        json={"username": "admin_user", "password": "adminpassword"}
    )
    assert response.status_code == 200
    login_data = response.json()
    assert "access_token" in login_data
    assert login_data["role"] == "Admin"

def test_role_based_permissions():
    # Register guest and get token
    res = client.post(
        "/api/login",
        json={"username": "guest_user", "password": "password123"}
    )
    guest_token = res.json()["access_token"]
    
    # Register Admin and get token
    res = client.post(
        "/api/login",
        json={"username": "admin_user", "password": "adminpassword"}
    )
    admin_token = res.json()["access_token"]
    
    # Guest trying to upload file should fail (Forbidden)
    response = client.post(
        "/api/upload",
        headers={"Authorization": f"Bearer {guest_token}"},
        files={"file": ("test.txt", b"Mock clinical guideline text.")}
    )
    assert response.status_code == 403  # Forbidden
    
    # Admin uploading should succeed
    response = client.post(
        "/api/upload",
        headers={"Authorization": f"Bearer {admin_token}"},
        files={"file": ("guidelines.txt", b"Aspirin 81mg is recommended for high risk cardiovascular disease prevention.")}
    )
    assert response.status_code == 200
    doc_data = response.json()
    assert doc_data["filename"] == "guidelines.txt"
    assert doc_data["chunks"] > 0

def test_search_and_chat():
    # Login admin
    res = client.post(
        "/api/login",
        json={"username": "admin_user", "password": "adminpassword"}
    )
    token = res.json()["access_token"]
    
    # Test semantic search (runs in mock mode keywords search)
    response = client.get(
        "/api/search?q=Aspirin cardiovascular",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    search_results = response.json()
    assert len(search_results) > 0
    assert "Aspirin" in search_results[0]["content"]
    
    # Test Chat conversation
    response = client.post(
        "/api/chat",
        headers={"Authorization": f"Bearer {token}"},
        json={"message": "What is the recommended dose of Aspirin?"}
    )
    assert response.status_code == 200
    chat_res = response.json()
    assert "session_id" in chat_res
    assert "message" in chat_res
    assert "content" in chat_res["message"]
    assert "guidelines.txt" in chat_res["message"]["content"] or len(chat_res["message"]["citations"]) > 0

def test_analytics():
    # Login admin
    res = client.post(
        "/api/login",
        json={"username": "admin_user", "password": "adminpassword"}
    )
    token = res.json()["access_token"]
    
    # Admin fetch analytics should succeed
    response = client.get(
        "/api/analytics",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    metrics_data = response.json()
    assert "metrics" in metrics_data
    assert metrics_data["metrics"]["total_documents"] == 1
    assert metrics_data["metrics"]["total_queries"] >= 1
    assert "system_status" in metrics_data
    assert "recent_activities" in metrics_data
