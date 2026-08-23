import os
from dotenv import load_dotenv

# Load .env file if it exists
load_dotenv(override=True)

# Project root directory
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# API configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
IS_MOCK_MODE = not bool(GEMINI_API_KEY)

# Database configuration
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./healthcare_rag.db")
if DATABASE_URL.startswith("sqlite:///"):
    sqlite_path = DATABASE_URL[10:]
    if not os.path.isabs(sqlite_path) and sqlite_path != ":memory:":
        if sqlite_path.startswith("./") or sqlite_path.startswith(".\\"):
            sqlite_path = sqlite_path[2:]
        abs_db_path = os.path.abspath(os.path.join(BASE_DIR, sqlite_path)).replace('\\', '/')
        DATABASE_URL = f"sqlite:///{abs_db_path}"

# Vector DB configuration
QDRANT_PATH = os.getenv("QDRANT_PATH", "./qdrant_db")
if QDRANT_PATH != ":memory:" and not os.path.isabs(QDRANT_PATH):
    QDRANT_PATH = os.path.abspath(os.path.join(BASE_DIR, QDRANT_PATH)).replace('\\', '/')

# JWT configuration
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "super-secret-healthcare-rag-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60
