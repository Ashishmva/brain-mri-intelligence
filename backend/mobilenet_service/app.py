
import io
import json
import os
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps
from safetensors.torch import load_file

SERVICE_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SERVICE_DIR.parent
MODEL_DIR = (
    BACKEND_DIR
    / "models"
    / "brainmri-ood-mobilenetv2-100"
)

MODEL = None
CONFIG = None
MODEL_ERROR = None

app = FastAPI(
    title="Brain MRI MobileNetV2 Research API",
    version="1.0.0",
    description=(
        "Experimental binary MRI image classifier. "
        "Not for clinical diagnosis."
    ),
)

origins = os.getenv("ALLOWED_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[item.strip() for item in origins],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def load_research_model():
    global MODEL, CONFIG, MODEL_ERROR

    try:
        config_path = MODEL_DIR / "config.json"
        weights_path = MODEL_DIR / "model.safetensors"
        modeling_path = MODEL_DIR / "modeling.py"

        for path in (config_path, weights_path, modeling_path):
            if not path.exists():
                raise FileNotFoundError(
                    f"Required model file not found: {path.name}"
                )

        with config_path.open("r", encoding="utf-8") as handle:
            CONFIG = json.load(handle)

        if str(MODEL_DIR) not in sys.path:
            sys.path.insert(0, str(MODEL_DIR))

        from modeling import build_model

        architecture = CONFIG["architecture"]
        model = build_model(architecture, num_classes=2)

        state_dict = load_file(str(weights_path), device="cpu")
        model.load_state_dict(state_dict, strict=True)
        model.eval()

        MODEL = model
        MODEL_ERROR = None

    except Exception as exc:
        MODEL = None
        MODEL_ERROR = str(exc)
        print(f"MobileNetV2 loading error: {exc}")


@app.on_event("startup")
def startup_event():
    load_research_model()


def prepare_image(image_bytes):
    try:
        image = Image.open(io.BytesIO(image_bytes))
        image = image.convert("RGB")

        image = ImageOps.pad(
            image,
            (224, 224),
            method=Image.Resampling.BILINEAR,
            color=(0, 0, 0),
            centering=(0.5, 0.5),
        )

        array = np.asarray(image, dtype=np.float32) / 255.0

        preprocessing = CONFIG["preprocessing"]

        mean = np.array(
            preprocessing["mean"],
            dtype=np.float32,
        )
        std = np.array(
            preprocessing["std"],
            dtype=np.float32,
        )
        array = (array - mean) / std
        array = np.transpose(array, (2, 0, 1))

        tensor = torch.from_numpy(
            np.ascontiguousarray(array)
        ).unsqueeze(0)

        return tensor

    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not process the uploaded image: {exc}",
        )


@app.get("/")
def root():
    return {
        "service": "Brain MRI MobileNetV2 Research API",
        "health": "/api/health",
        "status": "/api/mri/status",
        "analysis": "/api/mri/analyze",
        "docs": "/docs",
    }


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "model_loaded": MODEL is not None,
        "service": "brain-mri-mobilenetv2",
    }


@app.get("/api/mri/status")
def model_status():
    metrics = CONFIG.get("metrics", {}) if CONFIG else {}

    return {
        "model_loaded": MODEL is not None,
        "architecture": CONFIG.get("architecture") if CONFIG else None,
        "classes": ["no_tumor", "tumor"],
        "device": "cpu",
        "research_metrics": metrics,
        "error": MODEL_ERROR,
        "clinical_status": "NOT CLINICALLY VALIDATED",
        "warning": (
            "Research and educational use only. "
            "This model must not be used to diagnose, "
            "exclude, or make medical decisions about a tumor."
        ),
    }


@app.post("/api/mri/analyze")
async def analyze_mri(file: UploadFile = File(...)):
    if MODEL is None:
        raise HTTPException(
            status_code=503,
            detail="Research model is not loaded. Check /api/mri/status.",
        )

    filename = (file.filename or "").lower()

    if not filename.endswith((".png", ".jpg", ".jpeg")):
        raise HTTPException(
            status_code=415,
            detail="This endpoint currently accepts PNG and JPG images only.",
        )

    image_bytes = await file.read(20 * 1024 * 1024 + 1)

    if len(image_bytes) > 20 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="Image exceeds the 20 MB upload limit.",
        )

    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is empty.",
        )

    tensor = prepare_image(image_bytes)

    try:
        with torch.inference_mode():
            logits = MODEL(tensor)
            probabilities = F.softmax(logits, dim=1)[0].cpu().numpy()

        labels = [
            CONFIG["id2label"][str(index)]
            for index in range(2)
        ]

        predictions = [
            {
                "label": labels[index],
                "probability": round(float(probabilities[index]), 6),
            }
            for index in range(2)
        ]

        predictions.sort(
            key=lambda item: item["probability"],
            reverse=True,
        )

        return {
            "model": "MobileNetV2",
            "model_type": "experimental_binary_classifier",
            "filename": file.filename,
            "predictions": predictions,
            "research_result": predictions[0]["label"],
            "warning": (
                "Experimental research output only. "
                "The model has limited sensitivity and can miss "
                "tumor-positive cases. Do not use this result "
                "for diagnosis or to rule out a tumor."
            ),
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Research inference failed: {exc}",
        )
