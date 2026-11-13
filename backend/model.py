import os
from pathlib import Path
import numpy as np


def load_model():
    checkpoint_path = Path(os.getenv("MRI_MODEL_PATH", "models/brain_mri_classifier.pt"))
    if not checkpoint_path.exists():
        return None, []
    import torch
    from PIL import Image
    from .network import BrainMRIClassifier
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    labels = checkpoint["classes"]
    model = BrainMRIClassifier(num_classes=len(labels))
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    return model, labels


def predict_image(model, classes, array):
    import torch
    from PIL import Image
    values = np.asarray(array, dtype=np.float32)
    lo, hi = np.percentile(values, [1, 99])
    values = np.clip((values - lo) / max(float(hi - lo), 1e-6), 0, 1)
    image = Image.fromarray((values * 255).astype("uint8")).resize((224, 224))
    tensor = torch.from_numpy(np.asarray(image, dtype=np.float32) / 255.0)[None, None]
    with torch.no_grad():
        probabilities = torch.softmax(model(tensor), dim=1)[0].cpu().numpy()
    ranked = sorted(({"label": classes[i], "probability": round(float(probabilities[i]), 4)} for i in range(len(classes))), key=lambda x: x["probability"], reverse=True)
    return {"model_type": "experimental_2d_cnn", "predictions": ranked}
