---
library_name: timm
pipeline_tag: image-classification
license: mit
tags:
- pytorch
- safetensors
- timm
- image-classification
- brain-mri
- tumor-detection
- out-of-distribution
- medical-imaging
- benchmark
metrics:
- accuracy
- roc_auc
- f1
---

# MobileNetV2-100 (OOD Brain MRI)

This repository contains one trained checkpoint from **Brain MRI Tumor vs No-Tumor - OOD Generalization (10 Models)**, a comparative course project by Fatih AYIBASAN. It is one item in a 13-checkpoint benchmark covering 10 architectures.

**Research and educational use only. Not for clinical diagnosis or medical decision-making.**

- Project and training notebooks: [https://github.com/fatihaybsn/BrainMRI-OOD-10Models](https://github.com/fatihaybsn/BrainMRI-OOD-10Models)
- Source revision: [`a9920408189230b886773a64d113eb35bcba1971`](https://github.com/fatihaybsn/BrainMRI-OOD-10Models/commit/a9920408189230b886773a64d113eb35bcba1971)
- Classes: `no_tumor` (0), `tumor` (1)
- Architecture: `mobilenetv2_100`
- Input size: `224 x 224`
- Training augmentation: not used
- Decision threshold: `0.5`

## Project setting

As documented in the GitHub project, training used **11,500 images** from fixed 256 px and 512 px resolution pools. External/OOD evaluation used **3,500 images** with varying resolutions from 190 px to 800 px. The goal was to compare how standard, hybrid, and custom architectures generalize under source and resolution shift.

## This checkpoint's OOD result

| Accuracy | AUC | F1 | Recall / Sensitivity | Precision | Cohen's Kappa |
|---:|---:|---:|---:|---:|---:|
| 0.638795 | 0.889407 | 0.449649 | 0.290030 | 1.000000 | 0.286404 |

## Full benchmark

| Experiment | Accuracy | AUC | F1 | Recall | Precision | Kappa |
|---|---:|---:|---:|---:|---:|---:|
| custom_msaf_effb0_My_model_0.3_augmentation | 0.908 | 0.988 | 0.901 | 0.822 | 0.998 | 0.817 |
| hybrid_dn121_effb0_0.3_augmentation | 0.861 | 0.967 | 0.841 | 0.726 | 1.000 | 0.723 |
| hybrid_dn121_effb0_not_augmentation | 0.839 | 0.939 | 0.812 | 0.684 | 1.000 | 0.680 |
| custom_msaf_effb0_My_model_not_augmentation | 0.805 | 0.936 | 0.764 | 0.618 | 0.999 | 0.613 |
| hybrid_swinT_effb0_0.3_augmentation | 0.795 | 0.975 | 0.748 | 0.599 | 0.997 | 0.593 |
| resnet34_not_augmentatiton | 0.794 | 0.954 | 0.747 | 0.596 | 0.999 | 0.591 |
| densenet121 | 0.785 | 0.984 | 0.732 | 0.578 | 1.000 | 0.573 |
| convnext_tiny | 0.775 | 0.960 | 0.716 | 0.557 | 1.000 | 0.553 |
| hybrid_swinT_effb0_not_augmentation | 0.745 | 0.956 | 0.665 | 0.498 | 1.000 | 0.494 |
| resnet50_not_augmentatiton | 0.719 | 0.962 | 0.619 | 0.448 | 1.000 | 0.444 |
| inception_v3_not_augmentation | 0.710 | 0.901 | 0.602 | 0.430 | 1.000 | 0.426 |
| efficientnet_b0 | 0.693 | 0.903 | 0.568 | 0.397 | 0.997 | 0.392 |
| **mobilenetv2_100_not_augmentation (this checkpoint)** | 0.639 | 0.889 | 0.450 | 0.290 | 1.000 | 0.286 |

## Files and loading

- `model.safetensors`: tensor-only checkpoint converted from the original PyTorch state dict.
- `config.json`: architecture, preprocessing, label mapping, threshold, and provenance metadata.
- `original_checkpoint.sha256`: SHA-256 of the original trained `.pt` file.
- `results/`: available metrics, reports, thresholds, and result figures for this experiment.

```python
from pathlib import Path
import json
from safetensors.torch import load_file
from modeling import build_model

repo_dir = Path("downloaded-model-directory")
config = json.loads((repo_dir / "config.json").read_text())
model = build_model(config["architecture"], num_classes=2)
model.load_state_dict(load_file(repo_dir / "model.safetensors"), strict=True)
model.eval()
```

## Provenance

| Artifact | SHA-256 |
|---|---|
| Original trained `.pt` | `f995095dab16cc0099835d4820c48d8495de77ecd54cf6bdbc1fbe83773aae90` |
| Published `model.safetensors` | `8449eccfe66d885453c6bf6a71ded3e48894a20eb5b69c7e5b49f8fbb6891dd6` |

The checkpoint, executed notebooks, per-model metrics, result graphics, project report, and Git commit history are published together to provide a traceable record of the training and comparison work.

## Limitations

- Binary tumor/no-tumor classification only; it does not identify tumor type, location, grade, or prognosis.
- Performance was measured on the external/OOD test setup described in the project repository and may not transfer to clinical populations or acquisition protocols.
- Dataset bias, source shift, image artifacts, and subject leakage risks can affect performance.
- This model has not undergone clinical validation or regulatory review.

## Citation

Please cite the GitHub project using its [`CITATION.cff`](https://github.com/fatihaybsn/BrainMRI-OOD-10Models/blob/main/CITATION.cff).
