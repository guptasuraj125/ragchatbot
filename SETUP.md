# Setup Guide

This guide explains how to clone, configure, and run the project.

## 1. Clone the repository

Replace the URL with your real GitHub repository URL:

```bash
git clone https://github.com/your-username/company-chatbot-rag.git
cd company-chatbot-rag
```

## 2. Install Python

Recommended:

```text
Python 3.10+
```

Check:

```bash
python --version
```

## 3. Create a virtual environment

Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\activate
```

## 4. Install dependencies

```powershell
pip install -r requirements.txt
```

## 5. Create `.env`

Copy the example file:

```powershell
Copy-Item .env.example .env
```

Then open `.env` and add your real keys:

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

## 6. Start the FastAPI app

```powershell
uvicorn app:app --reload
```

Open:

```text
http://localhost:8000
```

## 7. Upload a PDF

Use the upload button in the UI.

The app will:

- save the uploaded PDF locally in `uploads/`
- extract text
- chunk it
- generate embeddings
- store them in Chroma Cloud
- use that uploaded PDF for chat in the current session

## 8. Push to GitHub

Before pushing:

```powershell
git status
```

Make sure `.env` is not listed.

Then:

```powershell
git add .
git commit -m "Add FastAPI PDF upload RAG chatbot"
git push origin main
```

## 9. Do not push secrets

Safe to push:

- source code
- `README.md`
- `SETUP.md`
- `.env.example`

Do not push:

- `.env`
- API keys
- secret tokens
