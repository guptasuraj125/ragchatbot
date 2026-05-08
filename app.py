import os
import re
import uuid
from pathlib import Path
from typing import Dict, List

from chromadb import CloudClient
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from groq import Groq
from pydantic import BaseModel
from pypdf import PdfReader
from sentence_transformers import SentenceTransformer

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
UPLOADS_DIR = BASE_DIR / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

COLLECTION_NAME = os.getenv("CHROMA_COLLECTION", "company-docs")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
SYSTEM_PROMPT = (BASE_DIR / "system-prompt.txt").read_text(encoding="utf-8").strip()
MAX_HISTORY = 12
CHROMA_TENANT = os.getenv("CHROMA_TENANT")
CHROMA_DATABASE = os.getenv("CHROMA_DATABASE")

if not os.getenv("GROQ_API_KEY"):
    raise RuntimeError("GROQ_API_KEY missing in .env")

if not os.getenv("CHROMA_API_KEY"):
    raise RuntimeError("CHROMA_API_KEY missing in .env")

if not CHROMA_TENANT:
    raise RuntimeError("CHROMA_TENANT missing in .env")

if not CHROMA_DATABASE:
    raise RuntimeError("CHROMA_DATABASE missing in .env")

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))
embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
chroma_client = CloudClient(
    tenant=CHROMA_TENANT,
    database=CHROMA_DATABASE,
    api_key=os.getenv("CHROMA_API_KEY"),
    cloud_host=os.getenv("CHROMA_HOST", "api.trychroma.com"),
)
collection_id_cache: str | None = None

app = FastAPI(title="Suraj RAG Chat API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/public", StaticFiles(directory=PUBLIC_DIR), name="public")

sessions: Dict[str, Dict[str, object]] = {}


class ChatBody(BaseModel):
    message: str


def get_collection_id() -> str:
    global collection_id_cache

    if collection_id_cache:
        return collection_id_cache

    response = chroma_client._server._make_request(
        "post",
        f"/tenants/{CHROMA_TENANT}/databases/{CHROMA_DATABASE}/collections",
        json={
            "name": COLLECTION_NAME,
            "metadata": None,
            "configuration": None,
            "get_or_create": True,
        },
    )
    collection_id = response.get("id")

    if not collection_id:
        raise RuntimeError("Could not resolve Chroma collection ID.")

    collection_id_cache = str(collection_id)
    return collection_id_cache


def get_session(request: Request) -> Dict[str, object]:
    session_id = request.cookies.get("session_id")
    is_new = False

    if not session_id:
        session_id = str(uuid.uuid4())
        is_new = True

    if session_id not in sessions:
        sessions[session_id] = {
            "history": [],
            "document_id": None,
            "document_name": None,
        }

    session = sessions[session_id]
    session["session_id"] = session_id
    session["is_new"] = is_new
    return session


def build_response(payload: dict, session: Dict[str, object]) -> JSONResponse:
    response = JSONResponse(payload)
    if session.get("is_new"):
        response.set_cookie("session_id", session["session_id"], httponly=True, samesite="lax")
    return response


def extract_pdf_text(file_path: Path) -> str:
    reader = PdfReader(str(file_path))
    pages = [page.extract_text() or "" for page in reader.pages]
    text = "\n".join(pages).strip()

    if not text:
        raise ValueError("No readable text found in the PDF.")

    return text


def chunk_text(text: str, chunk_size: int = 700, overlap: int = 120) -> List[str]:
    chunks: List[str] = []
    start = 0

    while start < len(text):
        end = min(len(text), start + chunk_size)
        chunk = text[start:end].strip()

        if chunk:
            chunks.append(chunk)

        if end >= len(text):
            break

        start = max(end - overlap, start + 1)

    return chunks


def embed_texts(texts: List[str]) -> List[List[float]]:
    return embedding_model.encode(texts, normalize_embeddings=True).tolist()


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("*", "").replace("\r", "")).strip()


def looks_like_list_question(question: str) -> bool:
    return bool(re.search(r"\b(list|leadership|names|team|members|steps|points|all)\b", question, re.I))


def format_list_answer(answer: str) -> str:
    cleaned = clean_text(answer)
    normalized = re.sub(
        r"\s+-\s+(CEO|CTO|COO|CFO|CMO|Head of [^:]+|Founder|Co-Founder|Director|Manager)\s*:",
        r"\n- \1:",
        cleaned,
        flags=re.I,
    )
    normalized = re.sub(r"\s+-\s+", "\n- ", normalized)
    lines = [line.strip() for line in normalized.split("\n") if line.strip()]

    if not lines:
        return cleaned
    if len(lines) == 1:
        return lines[0]

    first_line, *rest = lines
    items = [line if line.startswith("-") else f"- {line}" for line in rest]
    return "\n".join([first_line, *items])


def format_answer(question: str, answer: str) -> str:
    cleaned = clean_text(answer)
    if looks_like_list_question(question):
        return format_list_answer(cleaned)
    return cleaned


def build_history_text(history: List[dict]) -> str:
    return "\n".join(
        f"{'Assistant' if item['role'] == 'assistant' else 'User'}: {item['content']}"
        for item in history[-MAX_HISTORY:]
    )


@app.get("/")
async def root() -> FileResponse:
    return FileResponse(PUBLIC_DIR / "index.html")


@app.get("/styles.css")
async def styles() -> FileResponse:
    return FileResponse(PUBLIC_DIR / "styles.css", media_type="text/css")


@app.get("/app.js")
async def frontend_script() -> FileResponse:
    return FileResponse(PUBLIC_DIR / "app.js", media_type="application/javascript")


@app.post("/api/upload")
async def upload_pdf(request: Request, file: UploadFile = File(...)) -> JSONResponse:
    session = get_session(request)
    collection_id = get_collection_id()

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file.")

    document_id = str(uuid.uuid4())
    safe_name = f"{document_id}_{Path(file.filename).name}"
    file_path = UPLOADS_DIR / safe_name

    with file_path.open("wb") as buffer:
        buffer.write(await file.read())

    try:
        text = extract_pdf_text(file_path)
        chunks = chunk_text(text)
        embeddings = embed_texts(chunks)
    except Exception as error:
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(error)) from error

    ids = [f"{document_id}-{index}" for index in range(len(chunks))]
    metadatas = [
        {
            "document_id": document_id,
            "source": file.filename,
            "chunk_index": index,
        }
        for index in range(len(chunks))
    ]

    chroma_client._server._make_request(
        "post",
        f"/tenants/{CHROMA_TENANT}/databases/{CHROMA_DATABASE}/collections/{collection_id}/upsert",
        json={
            "ids": ids,
            "embeddings": embeddings,
            "metadatas": metadatas,
            "documents": chunks,
            "uris": None,
        },
    )

    session["document_id"] = document_id
    session["document_name"] = file.filename
    session["history"] = []

    return build_response(
        {
            "message": "PDF uploaded and indexed successfully.",
            "document_id": document_id,
            "document_name": file.filename,
            "chunks": len(chunks),
        },
        session,
    )


@app.post("/api/chat")
async def chat(request: Request, body: ChatBody) -> JSONResponse:
    session = get_session(request)
    collection_id = get_collection_id()
    message = body.message.strip()

    if not message:
        raise HTTPException(status_code=400, detail="Message is required.")

    document_id = session.get("document_id")
    if not document_id:
        raise HTTPException(status_code=400, detail="Upload a PDF first.")

    query_embedding = embed_texts([message])[0]
    result = chroma_client._server._make_request(
        "post",
        f"/tenants/{CHROMA_TENANT}/databases/{CHROMA_DATABASE}/collections/{collection_id}/query",
        json={
            "query_embeddings": [query_embedding],
            "n_results": 3,
            "where": {"document_id": document_id},
            "where_document": None,
            "include": ["documents", "metadatas", "distances"],
        },
    )

    documents = result.get("documents", [[]])[0]
    context = "\n\n".join(documents) if documents else "No relevant context found."
    history_text = build_history_text(session["history"])

    completion = groq_client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Conversation history:\n{history_text or 'No previous conversation.'}\n\n"
                    f"Question: {message}\n\n"
                    f"Context:\n{context}\n\n"
                    f"Answer:"
                ),
            },
        ],
    )

    answer = format_answer(message, completion.choices[0].message.content or "I don't know.")
    session["history"].extend(
        [
            {"role": "user", "content": message},
            {"role": "assistant", "content": answer},
        ]
    )
    session["history"] = session["history"][-MAX_HISTORY:]

    return build_response(
        {
            "answer": answer,
            "document_name": session.get("document_name"),
        },
        session,
    )


@app.post("/api/reset")
async def reset_chat(request: Request) -> JSONResponse:
    session = get_session(request)
    session["history"] = []
    return build_response({"ok": True}, session)
