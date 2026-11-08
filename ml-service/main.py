"""FastAPI inference service: feature-vector sequence in, cognitive state out."""

from __future__ import annotations

import math
from dataclasses import asdict

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from model import FEATURE_DIM
from predictor import Predictor, configured_run

app = FastAPI(title="Cognitive State Inference Service")

# Fails at startup (rather than serving wrong predictions) if MODEL_RUN is broken.
predictor = Predictor(configured_run())


class InferRequest(BaseModel):
    # Sequence of per-window feature vectors, oldest first: (seq_len, FEATURE_DIM).
    features: list[list[float]]


class ModelInfoOut(BaseModel):
    name: str
    data: str | None
    trained: bool


class InferResponse(BaseModel):
    state: str
    probs: dict[str, float]
    model: ModelInfoOut


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "model": asdict(predictor.info)}


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
        if not all(math.isfinite(v) for v in row):
            raise HTTPException(status_code=422, detail=f"features[{i}] contains NaN or infinity")

    state, probs = predictor.predict(req.features)
    return InferResponse(state=state, probs=probs, model=ModelInfoOut(**asdict(predictor.info)))
