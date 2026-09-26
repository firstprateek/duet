# duet-sorter

Duet's sorting service on the Mac mini. It keeps nothing: each request is answered from memory
and forgotten, and request logging is off. The app on each Mac does the matching; this service
only lends it models it can't run itself.

| Endpoint | What it does |
| --- | --- |
| `GET /v1/health` | Which models are ready |
| `POST /v1/embed` | Vectors for transaction descriptions, from Ollama's embedding model |
| `POST /v1/choose` | Laya picks one of a few candidate categories, once it's trained on our history |
| `POST /v1/generate` | The small LLM, answering only in the JSON shape it's given |

```bash
uv sync
uv run duet-sorter          # 127.0.0.1:8788; tailscale serve publishes it under /sort
uv run pytest
```

Settings come from the environment: `OLLAMA_URL` (default `http://127.0.0.1:11434`),
`DUET_EMBED_MODEL` (default `nomic-embed-text`), `DUET_LLM_MODEL` (default
`qwen2.5:7b-instruct`, to be settled by the M4 evaluation) and `DUET_LAYA_URL` (Laya's own HTTP
server, once it's fine-tuned; until then `/v1/choose` says it isn't ready and the LLM handles the
hard rows).
