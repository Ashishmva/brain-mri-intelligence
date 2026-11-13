from __future__ import annotations

import torch
import torch.nn as nn
import timm


class HybridDN121EffB0(nn.Module):
    def __init__(self, num_classes=2, head_dim=256, dropout=0.2):
        super().__init__()
        self.bb1 = timm.create_model("densenet121", pretrained=False, num_classes=0, global_pool="avg")
        self.bb2 = timm.create_model("efficientnet_b0", pretrained=False, num_classes=0, global_pool="avg")
        self.head = nn.Sequential(nn.Linear(self.bb1.num_features + self.bb2.num_features, head_dim), nn.GELU(), nn.Dropout(dropout), nn.Linear(head_dim, num_classes))
    def forward(self, x):
        return self.head(torch.cat([self.bb1(x), self.bb2(x)], dim=1))


class HybridSwinTEffB0(nn.Module):
    def __init__(self, num_classes=2, head_dim=256, dropout=0.2):
        super().__init__()
        self.bb1 = timm.create_model("swin_tiny_patch4_window7_224", pretrained=False, num_classes=0, global_pool="avg")
        self.bb2 = timm.create_model("efficientnet_b0", pretrained=False, num_classes=0, global_pool="avg")
        self.head = nn.Sequential(nn.Linear(self.bb1.num_features + self.bb2.num_features, head_dim), nn.GELU(), nn.Dropout(dropout), nn.Linear(head_dim, num_classes))
    def forward(self, x):
        return self.head(torch.cat([self.bb1(x), self.bb2(x)], dim=1))


class SEBlock(nn.Module):
    def __init__(self, channels, reduction=16):
        super().__init__()
        hidden = max(8, channels // reduction)
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.fc = nn.Sequential(nn.Linear(channels, hidden, bias=False), nn.GELU(), nn.Linear(hidden, channels, bias=False), nn.Sigmoid())
    def forward(self, x):
        b, c, _, _ = x.shape
        return x * self.fc(self.pool(x).view(b, c)).view(b, c, 1, 1)


class Conv1x1BNAct(nn.Module):
    def __init__(self, in_ch, out_ch):
        super().__init__()
        self.net = nn.Sequential(nn.Conv2d(in_ch, out_ch, 1, bias=False), nn.BatchNorm2d(out_ch), nn.GELU())
    def forward(self, x):
        return self.net(x)


class CustomMSAFEffB0(nn.Module):
    def __init__(self, num_classes=2, embed_dim=256, head_dim=256, dropout=0.35):
        super().__init__()
        self.backbone = timm.create_model("efficientnet_b0", pretrained=False, features_only=True, out_indices=(2, 3, 4))
        channels = self.backbone.feature_info.channels()
        self.proj = nn.ModuleList([Conv1x1BNAct(c, embed_dim) for c in channels])
        self.se = nn.ModuleList([SEBlock(embed_dim) for _ in channels])
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.scale_attn = nn.Sequential(nn.Linear(embed_dim, max(8, embed_dim // 4)), nn.GELU(), nn.Dropout(dropout * 0.25), nn.Linear(max(8, embed_dim // 4), 1))
        self.head = nn.Sequential(nn.Linear(embed_dim * (len(channels) + 1), head_dim), nn.GELU(), nn.Dropout(dropout), nn.Linear(head_dim, num_classes))
    def forward(self, x):
        vecs = [self.pool(se(proj(f))).flatten(1) for f, proj, se in zip(self.backbone(x), self.proj, self.se)]
        ms = torch.stack(vecs, dim=1)
        weights = torch.softmax(self.scale_attn(ms).squeeze(-1), dim=1)
        return self.head(torch.cat([(ms * weights.unsqueeze(-1)).sum(dim=1), ms.flatten(1)], dim=1))


def build_model(architecture, num_classes=2):
    if architecture == "hybrid_dn121_effb0":
        return HybridDN121EffB0(num_classes=num_classes)
    if architecture == "hybrid_swint_effb0":
        return HybridSwinTEffB0(num_classes=num_classes)
    if architecture == "custom_msaf_effb0":
        return CustomMSAFEffB0(num_classes=num_classes)
    return timm.create_model(architecture, pretrained=False, num_classes=num_classes)
