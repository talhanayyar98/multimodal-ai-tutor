"""FastAPI inference service: feature-vector sequence in, cognitive state out."""

from __future__ import annotations

import os

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from model import FEATURE_DIM, STATES, load_model

app = FastAPI(title="Cognitive State Inference Service")

model = load_model(os.environ.get("MODEL_WEIGHTS"))


class InferRequest(BaseModel):
    # Sequence of per-window feature vectors: (seq_len, FEATURE_DIM).
    features: list[list[float]]


class InferResponse(BaseModel):
    state: str
    probs: dict[str, float]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/infer", response_model=InferResponse)
def infer(req: InferRequest) -> InferResponse:
    if not req.features:
        raise HTTPException(status_code=422, detail="features must contain at least one window")
    for i, row in enumerate(req.features):
        if len(row) != FEATURE_DIM:
            raise HTTPException(
                status_code=422,
                detail=f"features[{i}] has {len(row)} values, expected {FEATURE_DIM}",
            )

    x = torch.tensor([req.features], dtype=torch.float32)  # (1, seq_len, FEATURE_DIM)
    with torch.no_grad():
        logits = model(x)
        probs = torch.softmax(logits, dim=-1).squeeze(0)

    top = int(probs.argmax().item())
    return InferResponse(
        state=STATES[top],
        probs={state: round(float(p), 4) for state, p in zip(STATES, probs.tolist())},
    )
