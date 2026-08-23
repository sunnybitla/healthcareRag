# Healthcare RAG (Retrieval-Augmented Generation) System

A robust Retrieval-Augmented Generation (RAG) platform tailored for healthcare and clinical documentation, featuring vector search, semantic document exploration, compliance analytics, and conversational intelligence powered by Google Gemini and Qdrant.

## Architecture

- **Backend**: FastAPI (Python 3.10+), SQLAlchemy / SQLite, Qdrant Vector Store, Google Gemini Embeddings & Generation (`google-genai`), JWT Authentication.
- **Frontend**: Next.js 15+ (React 19, TypeScript), Tailwind CSS / Vanilla CSS modern UI, Lucide Icons.

## Project Structure

```
.
├── backend/                  # FastAPI backend service
│   ├── auth.py               # JWT & user authentication handlers
│   ├── config.py             # App configuration & settings
│   ├── database.py           # Database connection & session
│   ├── main.py               # API endpoints & routing
│   ├── models.py             # SQLAlchemy models & Pydantic schemas
│   ├── rag.py                # RAG engine (Qdrant + Gemini integration)
│   ├── requirements.txt      # Python dependencies
│   └── test_api.py           # Backend unit & integration tests
├── frontend/                 # Next.js frontend application
│   ├── app/                  # Next.js App Router pages & components
│   ├── package.json          # Frontend dependencies
│   └── tsconfig.json         # TypeScript configuration
├── sample_cardiovascular_guideline.txt
├── .env.example              # Sample environment variables
└── README.md
```

## Getting Started

### 1. Environment Setup

Copy `.env.example` to `.env` and fill in your Gemini API key:

```bash
cp .env.example .env
```

### 2. Backend Setup

```bash
cd backend
python -m venv venv
# On Windows:
venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Backend API documentation will be available at [http://localhost:8000/docs](http://localhost:8000/docs).

### 3. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend application will be accessible at [http://localhost:3000](http://localhost:3000).

## License

MIT
