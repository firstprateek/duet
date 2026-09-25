"""Duet's sorting service on the Mac mini (spec, "Smart sorting").

It keeps nothing: every request is answered from memory and forgotten, and request logging is
off. The app on each Mac does the matching and decides; this service only lends it models:

  POST /v1/embed     vectors for descriptions, from Ollama's embedding model
  POST /v1/choose    Laya picks one of a few candidate categories, once it's trained
  POST /v1/generate  the small LLM, answering only in the JSON shape it's given

tailscale serve publishes it under /sort on the Mac mini, so every route also answers there.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from typing import Any

import httpx
from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

MAX_TEXTS = 256
MAX_TEXT = 512


class Settings:
    def __init__(self, env: Mapping[str, str] = os.environ) -> None:
        self.ollama_url = env.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
        self.embed_model = env.get("DUET_EMBED_MODEL", "nomic-embed-text")
        self.llm_model = env.get("DUET_LLM_MODEL", "qwen2.5:7b-instruct")
        self.laya_url = (env.get("DUET_LAYA_URL") or "").rstrip("/") or None


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=MAX_TEXTS)


class ChooseRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    candidates: list[str] = Field(min_length=2, max_length=8)


class GenerateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    prompt: str = Field(min_length=1, max_length=8000)
    json_schema: dict[str, Any] = Field(alias="schema")
    system: str | None = Field(default=None, max_length=4000)


def _has_model(installed: list[str], wanted: str) -> bool:
    """Ollama lists "nomic-embed-text:latest" for "nomic-embed-text"."""
    base = wanted if ":" in wanted else f"{wanted}:latest"
    return wanted in installed or base in installed


def create_app(
    settings: Settings | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    settings = settings or Settings()
    client = httpx.AsyncClient(timeout=120, transport=transport)
    router = APIRouter()

    async def ollama(path: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = await client.post(f"{settings.ollama_url}{path}", json=payload)
        except httpx.HTTPError as error:
            raise HTTPException(503, "Ollama isn't running on the Mac mini.") from error
        if response.status_code == 404:
            model = payload.get("model", "")
            raise HTTPException(503, f"Ollama doesn't have {model} yet. Run: ollama pull {model}")
        if response.status_code >= 400:
            raise HTTPException(502, "Ollama couldn't answer.")
        return response.json()

    @router.get("/v1/health")
    async def health() -> dict[str, Any]:
        installed: list[str] = []
        ollama_up = False
        try:
            response = await client.get(f"{settings.ollama_url}/api/tags")
            response.raise_for_status()
            installed = [m.get("name", "") for m in response.json().get("models", [])]
            ollama_up = True
        except (httpx.HTTPError, ValueError):
            pass
        return {
            "ok": True,
            "ollama": ollama_up,
            "embed": {"model": settings.embed_model, "ready": _has_model(installed, settings.embed_model)},
            "llm": {"model": settings.llm_model, "ready": _has_model(installed, settings.llm_model)},
            "laya": {"ready": settings.laya_url is not None},
        }

    @router.post("/v1/embed")
    async def embed(body: EmbedRequest) -> dict[str, Any]:
        texts = [text[:MAX_TEXT] for text in body.texts]
        data = await ollama("/api/embed", {"model": settings.embed_model, "input": texts})
        vectors = data.get("embeddings")
        if not isinstance(vectors, list) or len(vectors) != len(texts):
            raise HTTPException(502, "The embedding model answered oddly.")
        return {"model": settings.embed_model, "vectors": vectors}

    @router.post("/v1/choose")
    async def choose(body: ChooseRequest) -> dict[str, Any]:
        if settings.laya_url is None:
            raise HTTPException(503, "Laya isn't trained on our history yet.")
        try:
            response = await client.post(
                f"{settings.laya_url}/choose",
                json={"text": body.text, "candidates": body.candidates},
            )
            response.raise_for_status()
            data = response.json()
            index = int(data["index"])
            probability = float(data["probability"])
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as error:
            raise HTTPException(502, "Laya couldn't answer.") from error
        if not 0 <= index < len(body.candidates) or not 0 <= probability <= 1:
            raise HTTPException(502, "Laya answered oddly.")
        return {"index": index, "probability": probability}

    @router.post("/v1/generate")
    async def generate(body: GenerateRequest) -> dict[str, Any]:
        messages = [{"role": "system", "content": body.system}] if body.system else []
        messages.append({"role": "user", "content": body.prompt})
        data = await ollama(
            "/api/chat",
            {
                "model": settings.llm_model,
                "messages": messages,
                "format": body.json_schema,
                "stream": False,
                "options": {"temperature": 0},
            },
        )
        content = (data.get("message") or {}).get("content", "")
        try:
            output = json.loads(content)
        except (json.JSONDecodeError, TypeError) as error:
            raise HTTPException(502, "The model didn't answer in JSON.") from error
        if not isinstance(output, dict):
            raise HTTPException(502, "The model didn't answer in the shape asked for.")
        missing = [key for key in body.json_schema.get("required", []) if key not in output]
        if missing:
            raise HTTPException(502, "The model left something out.")
        return {"output": output}

    app = FastAPI(title="Duet sorter", docs_url=None, redoc_url=None, openapi_url=None)
    app.include_router(router)
    app.include_router(router, prefix="/sort")
    # The app's webview asks from its own origin; there are no cookies, and the tailnet ACL is the lock.
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"], allow_headers=["*"])
    return app


app = create_app()
