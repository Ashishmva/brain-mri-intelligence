import base64
import io
import os
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .model import load_model, predict_image

MAX_BYTES = 80 * 1024 * 1024
app = FastAPI(title="Brain MRI Intelligence API", version="1.0.0")
origins = [x.strip() for x in os.getenv("ALLOWED_ORIGINS", "*").split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
MODEL = {"model": None, "classes": [], "error": None}


@app.get("/")
def root():
    return {"service": "Brain MRI Intelligence API", "docs": "/docs", "health": "/api/health"}


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "brain-mri-intelligence"}


@app.get("/api/mri/status")
def status():
    path = Path(os.getenv("MRI_MODEL_PATH", "models/brain_mri_classifier.pt"))
    return {
        "service": "ready",
        "scan_inspection": True,
        "formats": ["PNG", "JPEG", "DICOM", "NIfTI"],
        "classifier_loaded": MODEL["model"] is not None,
        "model_file_found": path.exists(),
        "model_error": MODEL["error"],
        "notice": "Research prototype only; not for diagnosis or clinical decisions.",
    }


async def read_upload(file: UploadFile):
    name = file.filename or "scan"
    lower = name.lower()
    supported = lower.endswith((".png", ".jpg", ".jpeg", ".dcm", ".dicom", ".nii", ".nii.gz"))
    if not supported:
        raise HTTPException(400, "Unsupported file. Upload PNG, JPG, DICOM or NIfTI (.nii/.nii.gz).")
    data = await file.read(MAX_BYTES + 1)
    if not data:
        raise HTTPException(400, "The uploaded file is empty.")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File exceeds the 80 MB upload limit.")
    return name, data


def to_uint8(array):
    arr = np.asarray(array, dtype=np.float32)
    arr = np.nan_to_num(arr, nan=0.0, posinf=0.0, neginf=0.0)
    low, high = np.percentile(arr, [1, 99])
    if high <= low:
        low, high = float(arr.min()), float(arr.max())
    if high <= low:
        return np.zeros(arr.shape, dtype=np.uint8)
    return np.clip((arr - low) / (high - low) * 255, 0, 255).astype(np.uint8)


def make_preview(array):
    image = Image.fromarray(to_uint8(array)).convert("L")
    image.thumbnail((1000, 1000))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def inspect_scan(name, data):
    lower = name.lower()
    meta = {"filename": Path(name).name, "file_size_bytes": len(data)}
    if lower.endswith((".png", ".jpg", ".jpeg")):
        try:
            image = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("L")
            array = np.asarray(image)
            meta.update({"format": image.format or Path(name).suffix.upper(), "width_px": image.width, "height_px": image.height, "channels": 1})
            return meta, array, make_preview(array)
        except Exception as exc:
            raise HTTPException(400, f"Image decode failed: {exc}")
    if lower.endswith((".dcm", ".dicom")):
        try:
            import pydicom
            ds = pydicom.dcmread(io.BytesIO(data), force=True)
            array = ds.pixel_array
            if array.ndim == 3:
                array = array[array.shape[0] // 2]
            if array.ndim != 2:
                raise ValueError("Only 2-D images or middle frame of 3-D multi-frame DICOM are supported.")
            meta.update({
                "format": "DICOM", "modality": str(getattr(ds, "Modality", "Not supplied")),
                "rows": int(getattr(ds, "Rows", array.shape[0])),
                "columns": int(getattr(ds, "Columns", array.shape[1])),
                "pixel_spacing": str(getattr(ds, "PixelSpacing", "Not supplied")),
                "patient_identifiers": "Not returned by this API",
            })
            return meta, np.asarray(array), make_preview(array)
        except Exception as exc:
            raise HTTPException(400, f"DICOM decode failed. Compressed pixel data may require an additional codec. {exc}")
    if lower.endswith((".nii", ".nii.gz")):
        temp_path = None
        try:
            import nibabel as nib
            suffix = ".nii.gz" if lower.endswith(".nii.gz") else ".nii"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp:
                temp.write(data)
                temp_path = temp.name
            volume = nib.load(temp_path)
            voxels = np.asarray(volume.dataobj)
            if voxels.ndim < 3:
                raise ValueError("NIfTI input must contain at least three dimensions.")
            slice_2d = np.rot90(voxels[:, :, voxels.shape[2] // 2])
            meta.update({"format": "NIfTI", "dimensions": list(volume.shape), "voxel_spacing_mm": [round(float(v), 4) for v in volume.header.get_zooms()[:3]], "preview_slice": "central axial slice"})
            return meta, slice_2d, make_preview(slice_2d)
        except Exception as exc:
            raise HTTPException(400, f"NIfTI decode failed: {exc}")
        finally:
            if temp_path and os.path.exists(temp_path):
                os.remove(temp_path)
    raise HTTPException(400, "Unsupported file type.")


@app.post("/api/mri/inspect")
async def inspect(file: UploadFile = File(...)):
    name, data = await read_upload(file)
    metadata, _, preview = inspect_scan(name, data)
    return {"ok": True, "metadata": metadata, "preview": preview,
            "message": "Preview and metadata generated. This is not a diagnosis."}


@app.post("/api/mri/analyze")
async def analyze(file: UploadFile = File(...)):
    name, data = await read_upload(file)
    _, array, _ = inspect_scan(name, data)
    if MODEL["model"] is None:
        raise HTTPException(503, "No trained model checkpoint is installed. Scan inspection works; train and deploy a research checkpoint to enable classification.")
    try:
        output = predict_image(MODEL["model"], MODEL["classes"], array)
        return {"ok": True, "research_result": output,
                "notice": "Experimental research output only. Not a diagnosis or clinical recommendation."}
    except Exception as exc:
        raise HTTPException(500, f"Inference failed: {exc}")


@app.on_event("startup")
def load_startup_model():
    try:
        MODEL["model"], MODEL["classes"] = load_model()
    except Exception as exc:
        MODEL["error"] = str(exc)
