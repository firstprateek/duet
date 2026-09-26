import json

import httpx
from fastapi.testclient import TestClient

from duet_sorter.app import Settings, create_app


def fake_ollama(installed=("nomic-embed-text:latest", "qwen2.5:7b-instruct"), answer=None, down=False):
    """An Ollama stand-in that remembers what it was asked."""
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if down:
            raise httpx.ConnectError("refused", request=request)
        body = json.loads(request.content) if request.content else {}
        seen.append({"path": request.url.path, "body": body})
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": n} for n in installed]})
        if request.url.path == "/api/embed":
            if body["model"].split(":")[0] not in [n.split(":")[0] for n in installed]:
                return httpx.Response(404, json={"error": "model not found"})
            return httpx.Response(200, json={"embeddings": [[float(len(t)), 1.0] for t in body["input"]]})
        if request.url.path == "/api/chat":
            content = answer if answer is not None else json.dumps({"categoryId": "groceries", "confidence": 0.9})
            return httpx.Response(200, json={"message": {"role": "assistant", "content": content}})
        return httpx.Response(404)

    return httpx.MockTransport(handler), seen


def client_for(transport, **env):
    return TestClient(create_app(Settings(env), transport=transport))


def test_health_says_which_models_are_ready():
    transport, _ = fake_ollama(installed=("nomic-embed-text:latest",))
    body = client_for(transport).get("/v1/health").json()
    assert body["ollama"] is True
    assert body["embed"] == {"model": "nomic-embed-text", "ready": True}
    assert body["llm"]["ready"] is False
    assert body["laya"] == {"ready": False}


def test_health_answers_even_when_ollama_is_down():
    transport, _ = fake_ollama(down=True)
    body = client_for(transport).get("/v1/health").json()
    assert body["ok"] is True
    assert body["ollama"] is False


def test_embed_passes_vectors_through():
    transport, seen = fake_ollama()
    response = client_for(transport).post("/v1/embed", json={"texts": ["TRADER JOE S", "SHELL OIL"]})
    assert response.status_code == 200
    assert response.json() == {"model": "nomic-embed-text", "vectors": [[12.0, 1.0], [9.0, 1.0]]}
    assert seen[-1]["body"] == {"model": "nomic-embed-text", "input": ["TRADER JOE S", "SHELL OIL"]}


def test_embed_says_how_to_get_a_missing_model():
    transport, _ = fake_ollama(installed=())
    response = client_for(transport).post("/v1/embed", json={"texts": ["x"]})
    assert response.status_code == 503
    assert "ollama pull nomic-embed-text" in response.json()["detail"]


def test_ollama_down_is_a_plain_answer():
    transport, _ = fake_ollama(down=True)
    response = client_for(transport).post("/v1/embed", json={"texts": ["x"]})
    assert response.status_code == 503
    assert response.json()["detail"] == "Ollama isn't running on the Mac mini."


def test_generate_answers_in_the_shape_asked_for():
    transport, seen = fake_ollama()
    schema = {
        "type": "object",
        "properties": {"categoryId": {"type": "string"}, "confidence": {"type": "number"}},
        "required": ["categoryId", "confidence"],
    }
    response = client_for(transport).post(
        "/v1/generate",
        json={"prompt": "Which category is TRADER JOE S?", "schema": schema, "system": "Answer in JSON."},
    )
    assert response.status_code == 200
    assert response.json() == {"output": {"categoryId": "groceries", "confidence": 0.9}}
    sent = seen[-1]["body"]
    assert sent["format"] == schema
    assert sent["stream"] is False
    assert sent["options"] == {"temperature": 0}
    assert [m["role"] for m in sent["messages"]] == ["system", "user"]


def test_generate_refuses_answers_that_arent_json_or_miss_fields():
    schema = {"type": "object", "required": ["categoryId"]}
    transport, _ = fake_ollama(answer="groceries, probably")
    assert client_for(transport).post("/v1/generate", json={"prompt": "x", "schema": schema}).status_code == 502
    transport, _ = fake_ollama(answer=json.dumps({"confidence": 1}))
    response = client_for(transport).post("/v1/generate", json={"prompt": "x", "schema": schema})
    assert response.status_code == 502
    assert response.json()["detail"] == "The model left something out."


def test_choose_waits_for_laya():
    transport, _ = fake_ollama()
    response = client_for(transport).post("/v1/choose", json={"text": "SHELL OIL", "candidates": ["gas", "car"]})
    assert response.status_code == 503
    assert "Laya" in response.json()["detail"]


def test_choose_asks_laya_once_its_there():
    def laya(request: httpx.Request) -> httpx.Response:
        if request.url.host == "laya.local":
            return httpx.Response(200, json={"index": 1, "probability": 0.8})
        return httpx.Response(404)

    response = client_for(httpx.MockTransport(laya), DUET_LAYA_URL="http://laya.local").post(
        "/v1/choose", json={"text": "SHELL OIL", "candidates": ["car", "gas"]}
    )
    assert response.json() == {"index": 1, "probability": 0.8}


def test_every_route_also_answers_under_sort():
    transport, _ = fake_ollama()
    assert client_for(transport).get("/sort/v1/health").status_code == 200


def test_limits_how_much_is_sent_at_once():
    transport, _ = fake_ollama()
    response = client_for(transport).post("/v1/embed", json={"texts": ["x"] * 300})
    assert response.status_code == 422
