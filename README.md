# Brain MRI Intelligence

Independent research-oriented Brain MRI web application. Frontend: static HTML/CSS/JS for Vercel. Backend: FastAPI for Render. The project does not depend on Brahmand Ganga.

## Included
- MRI scan inspection for PNG/JPEG, DICOM and NIfTI uploads
- Metadata extraction and preview generation
- Optional PyTorch CNN classifier with its own architecture, training script and checkpoint format
- Dataset preparation guide and API health/status endpoints
- No permanent scan storage; NIfTI uses a temporary file that is deleted after reading

## Medical and model limitations
This is a research/education prototype, not a medical device. It does not diagnose or guide treatment. The included CNN architecture is an untrained model definition plus training pipeline; no trained weights or validated clinical dataset are bundled. Classification stays disabled until you train and deploy a checkpoint. Do not use outputs for clinical decisions.

## 1. Deploy backend to Render
Create a new GitHub repository, e.g. `brain-mri-intelligence`, and push this project. In Render create a **Web Service** from that repository:
- Runtime: Python
- Root directory: leave blank
- Build command: `pip install -r backend/requirements.txt`
- Start command: `uvicorn backend.app:app --host 0.0.0.0 --port $PORT`

After deployment, test `https://YOUR-RENDER-SERVICE.onrender.com/api/health`.

## 2. Connect and deploy frontend to Vercel
Edit `frontend/config.js` and set `window.MRI_API_BASE` to your exact Render service URL (without a trailing slash). Commit and push. Import the same GitHub repo into Vercel:
- Framework preset: Other
- Root directory: `frontend`
- Build command: leave blank
- Output directory: `.`

Set Render environment variable `ALLOWED_ORIGINS` to your exact Vercel origin, for example `https://brain-mri-intelligence.vercel.app`. For first smoke test, `*` is the default; restrict it after Vercel deployment.

## 3. Train your own model
Install optional dependencies locally: `pip install -r backend/requirements-training.txt`.

Prepare labelled 2D image slices in this structure (class names become the output labels):
```
dataset/
  train/
    class_one/*.png
    class_two/*.png
  val/
    class_one/*.png
    class_two/*.png
```
Use patient-level separation: slices from one patient must not appear in both train and validation sets. Keep a separate test set for final evaluation. Remove identifiers and ensure you have permission to use the data.

Train:
```
python -m backend.train_classifier --data-dir dataset --epochs 15 --output models/brain_mri_classifier.pt
```
The training script reports validation accuracy and saves a checkpoint. Copy the checkpoint to a persistent, secure location accessible to the backend and set Render `MRI_MODEL_PATH` to its path. Install the optional `torch` dependency in the backend environment if enabling inference; you may use a separate training build/runtime to avoid adding large ML dependencies to the initial lightweight deployment. Render's ephemeral filesystem can lose manually uploaded files after redeploy, so use a persistent disk or an external model artifact store for a lasting deployment.

## API
- `GET /api/health`
- `GET /api/mri/status`
- `POST /api/mri/inspect` (multipart field `file`)
- `POST /api/mri/analyze` (multipart field `file`; requires trained checkpoint)

Maximum upload size: 80 MB. DICOM decoding of compressed transfer syntaxes may require additional pixel-data codecs. NIfTI preview is the central axial slice. The example classifier is a basic 2D grayscale CNN; it is not a validated diagnostic model.

## Security before real patient data
The API currently has no authentication or user authorization. CORS is not authentication. Use only de-identified sample data until authentication, access controls, secure retention policy, monitoring and appropriate privacy/legal safeguards are implemented. Do not upload identifiable patient scans to this demo.
