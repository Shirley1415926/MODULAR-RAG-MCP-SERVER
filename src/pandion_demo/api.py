"""Starlette HTTP API and static dashboard for the Pandion RAG demo."""

from __future__ import annotations

import asyncio
import os
import threading
from pathlib import Path

from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Route

from src.core.settings import load_settings
from src.pandion_demo.service import PandionRAGService
from src.pandion_demo.operational_review import review_priorities
from src.pandion_demo.insight_chat import answer_question

REPO_ROOT = Path(__file__).resolve().parents[2]
DASHBOARD_PATH = REPO_ROOT / "examples" / "pandion_demo" / "dashboard.html"
SYNTHETIC_OPERATIONS_PATH = REPO_ROOT / "examples" / "pandion_demo" / "synthetic_operations.json"
_service: PandionRAGService | None = None
_service_lock = threading.Lock()


def get_service() -> PandionRAGService:
    global _service
    if _service is None:
        with _service_lock:
            if _service is None:
                settings_path = os.getenv("PANDION_SETTINGS_PATH")
                _service = PandionRAGService(load_settings(settings_path))
    return _service


async def dashboard(_: Request) -> FileResponse:
    return FileResponse(DASHBOARD_PATH)


async def synthetic_operations(_: Request) -> FileResponse:
    return FileResponse(SYNTHETIC_OPERATIONS_PATH, media_type="application/json")


async def dashboard_asset(request: Request) -> FileResponse:
    # Explicit allowlist: never expose configuration, keys or arbitrary repo files.
    name = request.path_params["name"]
    if name not in {"synthetic_operations.js", "clinic_model.js", "dashboard_app.js", "insight_chat.js"}:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return FileResponse(DASHBOARD_PATH.parent / name, media_type="text/javascript")


async def health(_: Request) -> JSONResponse:
    try:
        service = await asyncio.to_thread(get_service)
        stats = await asyncio.to_thread(service.collection_stats)
        return JSONResponse({
            "status": "ok" if stats.get("count", 0) else "needs_ingestion",
            "collection": service.collection,
            "records": stats.get("count", 0),
            "retrieval_mode": (
                "bm25"
                if service.sparse_only
                else "hybrid_dense_bm25_rrf"
            ),
            "generation_provider": service.settings.llm.provider,
        })
    except Exception as exc:
        return JSONResponse({"status": "error", "detail": str(exc)}, status_code=503)


async def insights(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
        scenario = str(payload.get("scenario", ""))
        context = str(payload.get("context", ""))
        metrics = payload.get("metrics") if isinstance(payload.get("metrics"), dict) else {}
        filters = payload.get("filters") if isinstance(payload.get("filters"), dict) else {}
        service = await asyncio.to_thread(get_service)
        result = await asyncio.to_thread(service.answer, scenario, context, metrics, filters)
        return JSONResponse(result)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)


async def operational_review(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise ValueError("Expected an object")
        service = await asyncio.to_thread(get_service)
        result = await asyncio.to_thread(review_priorities, service, payload)
        return JSONResponse(result)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception:
        return JSONResponse({"error": "Operational review unavailable"}, status_code=503)


async def insight_chat(request: Request) -> JSONResponse:
    try:
        raw=await request.body()
        if len(raw)>12000:
            return JSONResponse({'error':'Question payload too large'},status_code=413)
        payload=await request.json()
        result=await asyncio.to_thread(answer_question,await asyncio.to_thread(get_service),payload)
        return JSONResponse(result)
    except (ValueError,TypeError):
        return JSONResponse({'error':'Invalid question or analysis scope'},status_code=400)
    except Exception:
        return JSONResponse({'error':'Assistant unavailable; please retry'},status_code=503)


app = Starlette(routes=[
    Route("/", dashboard),
    Route("/synthetic_operations.json", synthetic_operations),
    Route("/api/health", health),
    Route("/api/insights", insights, methods=["POST"]),
    Route("/api/operational-review", operational_review, methods=["POST"]),
    Route("/api/insight-chat", insight_chat, methods=["POST"]),
    Route("/{name}", dashboard_asset),
])
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:8765", "http://localhost:8765", "null"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["content-type"],
)
