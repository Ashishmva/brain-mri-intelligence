
const $ = (id) => document.getElementById(id);

const API = (window.MRI_API_BASE || "").replace(/\/$/, "");
const MOBILENET_API = "https://brain-mri-mobilenetv2-api.onrender.com";

let selectedFile = null;
let localPreview = null;

function showMessage(text, error = false) {
  $("message").textContent = text;
  $("message").style.color = error ? "#ff9b9b" : "#68dce9";
}

function api(path) {
  if (!API) {
    throw new Error(
      "Backend URL is not configured. Set MRI_API_BASE in frontend/config.js and redeploy Vercel."
    );
  }

  return API + path;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[ch]);
}

function isValidOriginalFile(file) {
  return !!file && file.size > 0 && file.size <= 80 * 1024 * 1024;
}

function isSupportedMobileNetFile(file) {
  return (
    !!file &&
    file.size > 0 &&
    file.size <= 20 * 1024 * 1024 &&
    /\.(png|jpe?g)$/i.test(file.name)
  );
}

// --------------------------------------------------
// ORIGINAL BRAIN MRI BACKEND
// Existing API connection and functionality preserved
// --------------------------------------------------

async function checkBackend() {
  try {
    const response = await fetch(api("/api/mri/status"));

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    const state = await response.json();

    $("backendStatus").textContent = state.classifier_loaded
      ? "● API ONLINE · MODEL LOADED"
      : "● API ONLINE · SCAN VIEWER READY";

    $("backendStatus").style.color = "#75e0b3";

  } catch (error) {
    $("backendStatus").textContent = "● BACKEND NOT CONNECTED";
    $("backendStatus").style.color = "#e5b96b";
  }
}

// --------------------------------------------------
// SEPARATE MOBILENETV2 RESEARCH BACKEND
// --------------------------------------------------

function renderMobileNetMetrics(metrics) {
  const target = $("mobilenetMetrics");

  if (!target) return;

  if (!metrics || typeof metrics !== "object") {
    target.innerHTML = "";
    return;
  }

  const definitions = [
    ["Accuracy", "accuracy"],
    ["AUC", "auc"],
    ["F1 score", "f1"],
    ["Sensitivity", "recall_sensitivity"],
    ["Precision", "precision"],
    ["Kappa", "kappa"]
  ];

  const items = definitions
    .filter(([, key]) => Number.isFinite(Number(metrics[key])))
    .map(([label, key]) => {
      const value = Number(metrics[key]);

      const formatted = key === "kappa"
        ? value.toFixed(3)
        : (value * 100).toFixed(1) + "%";

      return `
        <div class="metric-chip">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(formatted)}</strong>
        </div>
      `;
    });

  target.innerHTML = items.join("");
}

async function checkMobileNetBackend() {
  const status = $("mobilenetStatus");
  const hint = $("mobilenetHint");

  try {
    const response = await fetch(
      `${MOBILENET_API}/api/mri/status`
    );

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    const state = await response.json();

    if (state.model_loaded) {
      status.textContent = "● MOBILENETV2 ONLINE · MODEL LOADED";
      status.style.color = "#75e0b3";

      if (hint) {
        hint.textContent =
          "Research inference service connected. PNG/JPG files up to 20 MB.";
      }
    } else {
      status.textContent = "● MOBILENETV2 API ONLINE · MODEL NOT LOADED";
      status.style.color = "#e5b96b";

      if (hint) {
        hint.textContent =
          "The API is reachable, but the research model is not currently loaded.";
      }
    }

    renderMobileNetMetrics(state.research_metrics);

  } catch (error) {
    status.textContent = "● MOBILENETV2 BACKEND NOT CONNECTED";
    status.style.color = "#e5b96b";

    if (hint) {
      hint.textContent =
        "The separate research inference service is currently unavailable.";
    }
  }
}

// --------------------------------------------------
// FILE SELECTION AND LOCAL PREVIEW
// --------------------------------------------------

function setFile(file) {
  selectedFile = file || null;

  $("fileName").textContent = selectedFile
    ? `${selectedFile.name} · ${(selectedFile.size / 1048576).toFixed(2)} MB`
    : "No file selected · 80 MB maximum";

  const validOriginal = isValidOriginalFile(selectedFile);
  const validMobileNet = isSupportedMobileNetFile(selectedFile);

  $("inspect").disabled = !validOriginal;
  $("analyze").disabled = !validOriginal;
  $("mobilenetAnalyze").disabled = !validMobileNet;

  if (localPreview) {
    URL.revokeObjectURL(localPreview);
  }

  localPreview = null;

  if (
    selectedFile &&
    /\.(png|jpe?g)$/i.test(selectedFile.name)
  ) {
    localPreview = URL.createObjectURL(selectedFile);

    $("viewport").innerHTML = `
      <img src="${localPreview}" alt="Local MRI scan preview">
    `;

    $("previewStatus").textContent = "LOCAL PREVIEW";

  } else {
    $("viewport").innerHTML = `
      <div class="empty">
        <b>＋</b>
        <span>Click Inspect scan to generate preview</span>
      </div>
    `;

    $("previewStatus").textContent = "AWAITING INSPECTION";
  }

  if (selectedFile && !validOriginal) {
    showMessage(
      "Please choose a non-empty file no larger than 80 MB.",
      true
    );

  } else {
    showMessage("");
  }

  const mobileHint = $("mobilenetHint");

  if (mobileHint && selectedFile && !validMobileNet) {
    mobileHint.textContent =
      "MobileNetV2 accepts PNG/JPG images up to 20 MB. The original backend remains available for supported files.";
  } else if (mobileHint && !selectedFile) {
    mobileHint.textContent =
      "Select a PNG/JPG MRI image up to 20 MB for MobileNetV2 research inference.";
  } else if (mobileHint && validMobileNet) {
    mobileHint.textContent =
      "Image ready for separate MobileNetV2 research inference.";
  }
}

$("scanFile").addEventListener("change", (event) => {
  setFile(event.target.files[0]);
});

$("drop").addEventListener("dragover", (event) => {
  event.preventDefault();
  $("drop").style.borderColor = "#68dce9";
});

$("drop").addEventListener("dragleave", () => {
  $("drop").style.borderColor = "";
});

$("drop").addEventListener("drop", (event) => {
  event.preventDefault();
  $("drop").style.borderColor = "";

  const file = event.dataTransfer.files[0];

  if (!file) return;

  const transfer = new DataTransfer();
  transfer.items.add(file);

  $("scanFile").files = transfer.files;

  setFile(file);
});

// --------------------------------------------------
// ORIGINAL BACKEND REQUEST HANDLER
// --------------------------------------------------

async function submitScan(path, button) {
  if (!selectedFile) return null;

  const previous = button.innerHTML;

  button.disabled = true;
  button.textContent = "Processing…";

  try {
    const body = new FormData();

    body.append("file", selectedFile);

    const response = await fetch(api(path), {
      method: "POST",
      body
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.detail || `Request failed (${response.status})`
      );
    }

    return data;

  } finally {
    button.disabled = false;
    button.innerHTML = previous;
  }
}

// --------------------------------------------------
// ORIGINAL SCAN INSPECTION
// --------------------------------------------------

$("inspect").addEventListener("click", async () => {
  showMessage("Sending scan for inspection…");

  try {
    const data = await submitScan(
      "/api/mri/inspect",
      $("inspect")
    );

    $("viewport").innerHTML = `
      <img src="${data.preview}" alt="Generated MRI preview">
    `;

    $("previewStatus").textContent = "PREVIEW GENERATED";

    const entries = Object.entries(data.metadata || {});

    $("metadata").innerHTML = entries
      .map(([key, value]) => `
        <div class="meta-item">
          <span>${escapeHtml(key.replaceAll("_", " "))}</span>
          <b>${escapeHtml(
            Array.isArray(value) ? value.join(" × ") : value
          )}</b>
        </div>
      `)
      .join("");

    const m = data.metadata || {};

    $("dimensions").textContent = m.width_px
      ? `${m.width_px} × ${m.height_px} PX`
      : m.rows
        ? `${m.columns} × ${m.rows} PX`
        : (m.dimensions || []).join(" × ") || "SCAN INSPECTED";

    showMessage(data.message || "Scan inspection complete.");

  } catch (error) {
    showMessage(error.message, true);
  }
});

// --------------------------------------------------
// ORIGINAL MRI ANALYSIS
// Existing endpoint and response handling preserved
// --------------------------------------------------

$("analyze").addEventListener("click", async () => {
  showMessage("Submitting scan to the original research inference endpoint…");

  try {
    const data = await submitScan(
      "/api/mri/analyze",
      $("analyze")
    );

    const predictions = data.research_result?.predictions || [];

    $("analysis").innerHTML = `
      <p>Experimental model output only — not a diagnosis.</p>
    ` + predictions.map((item) => `
      <div class="prediction">
        <b>${escapeHtml(item.label)}</b>
        <span>${(item.probability * 100).toFixed(1)}%</span>
      </div>
    `).join("");

    showMessage(data.notice || "Research inference complete.");

  } catch (error) {
    $("analysis").innerHTML = `
      <p>${escapeHtml(error.message)}</p>
    `;

    showMessage(error.message, true);
  }
});

// --------------------------------------------------
// SEPARATE MOBILENETV2 ANALYSIS
// Does not modify or replace the original backend
// --------------------------------------------------

$("mobilenetAnalyze").addEventListener("click", async () => {
  if (!isSupportedMobileNetFile(selectedFile)) {
    showMessage(
      "Choose a PNG or JPG image up to 20 MB for MobileNetV2.",
      true
    );
    return;
  }

  const button = $("mobilenetAnalyze");
  const previous = button.innerHTML;

  button.disabled = true;
  button.textContent = "Running MobileNetV2…";

  $("mobilenetAnalysis").innerHTML = `
    <p>Sending image to the separate MobileNetV2 research model…</p>
  `;

  showMessage("Running separate MobileNetV2 research inference…");

  try {
    const body = new FormData();

    body.append("file", selectedFile);

    const response = await fetch(
      `${MOBILENET_API}/api/mri/analyze`,
      {
        method: "POST",
        body
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.detail || data.error || `Request failed (${response.status})`
      );
    }

    const predictions = Array.isArray(data.predictions)
      ? data.predictions
      : [];

    const resultLabel =
      data.research_result ||
      data.predicted_class ||
      data.prediction ||
      "Inference completed";

    const predictionMarkup = predictions.length
      ? predictions.map((item) => {
          const label = item.label || "Unknown";
          const probability = Number(item.probability);

          const percentage = Number.isFinite(probability)
            ? (probability * 100).toFixed(1) + "%"
            : "N/A";

          return `
            <div class="prediction">
              <b>${escapeHtml(label)}</b>
              <span>${escapeHtml(percentage)}</span>
            </div>
          `;
        }).join("")
      : `
        <div class="result-summary">
          <span>Research output</span>
          <strong>${escapeHtml(resultLabel)}</strong>
        </div>
      `;

    $("mobilenetAnalysis").innerHTML = `
      <div class="research-tag">
        SEPARATE MOBILENETV2 · EXPERIMENTAL OUTPUT
      </div>

      <div class="result-summary">
        <span>Model result</span>
        <strong>${escapeHtml(resultLabel)}</strong>
      </div>

      ${predictionMarkup}

      <p class="output-note">
        This is an experimental binary classification result.
        It does not identify tumor location, type, or grade.
      </p>
    `;

    if (data.research_metrics) {
      renderMobileNetMetrics(data.research_metrics);
    }

    showMessage(
      data.notice || "MobileNetV2 research inference completed."
    );

  } catch (error) {
    $("mobilenetAnalysis").innerHTML = `
      <p>${escapeHtml(error.message)}</p>
    `;

    showMessage(error.message, true);

  } finally {
    button.disabled = !isSupportedMobileNetFile(selectedFile);
    button.innerHTML = previous;
  }
});

// --------------------------------------------------
// INITIALIZE BOTH BACKEND CONNECTIONS
// --------------------------------------------------

checkBackend();
checkMobileNetBackend();
