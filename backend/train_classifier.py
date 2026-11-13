import argparse
from pathlib import Path
import torch
from torch import nn
from torch.utils.data import DataLoader
from torchvision import datasets, transforms
from .network import BrainMRIClassifier


def main():
    parser = argparse.ArgumentParser(description="Train the Brain MRI research CNN on labelled 2-D image slices.")
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--output", default="models/brain_mri_classifier.pt")
    args = parser.parse_args()
    transform = transforms.Compose([transforms.Grayscale(1), transforms.Resize((224, 224)), transforms.ToTensor()])
    train = datasets.ImageFolder(Path(args.data_dir) / "train", transform=transform)
    val = datasets.ImageFolder(Path(args.data_dir) / "val", transform=transform)
    if train.classes != val.classes:
        raise SystemExit("train and val must contain identical class folder names")
    if len(train.classes) < 2:
        raise SystemExit("At least two label folders are required")
    train_loader = DataLoader(train, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val, batch_size=args.batch_size, shuffle=False)
    model = BrainMRIClassifier(len(train.classes))
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
    loss_fn = nn.CrossEntropyLoss()
    for epoch in range(args.epochs):
        model.train(); running = 0.0
        for images, labels in train_loader:
            optimizer.zero_grad(); loss = loss_fn(model(images), labels); loss.backward(); optimizer.step(); running += loss.item()
        model.eval(); correct = total = 0
        with torch.no_grad():
            for images, labels in val_loader:
                correct += (model(images).argmax(1) == labels).sum().item(); total += labels.numel()
        print(f"epoch={epoch+1}/{args.epochs} train_loss={running/max(len(train_loader),1):.4f} val_accuracy={correct/max(total,1):.4f}")
    output = Path(args.output); output.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": model.state_dict(), "classes": train.classes}, output)
    print(f"Checkpoint saved to {output}")


if __name__ == "__main__":
    main()
