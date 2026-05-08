# Suraj RAG Chat

A FastAPI-based RAG chatbot that lets users upload a PDF, indexes it into Chroma Cloud, and answers questions using Groq.

## Features

- PDF upload API with FastAPI
- No hardcoded PDF requirement
- Chroma Cloud vector storage
- Groq-powered answers
- Web chat UI
- Session memory
- Clean short responses

## Main Files

- `app.py`: FastAPI backend
- `public/`: frontend files
- `system-prompt.txt`: system prompt
- `.env.example`: environment template
- `requirements.txt`: Python dependencies

## Environment Setup

Copy `.env.example` to `.env` and fill your real values:

```env
GROQ_API_KEY=your_groq_api_key_here
CHROMA_HOST=api.trychroma.com
CHROMA_API_KEY=your_chroma_api_key_here
CHROMA_TENANT=your_chroma_tenant_here
CHROMA_DATABASE=your_chroma_database_here
CHROMA_COLLECTION=company-docs
GROQ_MODEL=openai/gpt-oss-20b
PORT=8000
```

## Run Locally

Create and activate a virtual environment:

```powershell
python -m venv .venv
.venv\Scripts\activate
```

Install dependencies:

```powershell
pip install -r requirements.txt
```

Start the FastAPI server:

```powershell
uvicorn app:app --reload
```

Open in browser:

```text
http://localhost:8000
```

Upload a PDF from the UI, then start chatting.

## API Endpoints

- `POST /api/upload`: upload and index a PDF
- `POST /api/chat`: ask questions against the uploaded PDF
- `POST /api/reset`: clear current session memory

## Important

- Do not push `.env` to GitHub
- `.env` is already ignored in `.gitignore`
- Only push `.env.example`

Detailed setup and clone instructions are in [SETUP.md](C:\Users\Admin\Desktop\company-chatbot-RAG\SETUP.md:1).
