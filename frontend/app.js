
const $ = (id) => document.getElementById(id);

const API = (window.MRI_API_BASE || "").replace(/\/$/, "");
const MOBILENET_API = "https://brain-mri-mobilenetv2-api.onrender.com";

let selectedFile = null;
let localPreview = null;

// Webcam scanner state
let cameraStream = null;
let cameraRunning = false;
let scanRunning = false;
let scanPaused = false;
let scanAnimation = null;
let scanCaptureTimer = null;
let scanLinePosition = 0;
let capturedFrames = [];
let cameraElements = null;

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

// ==================================================
// WEBCAM MRI AUTOMATIC LINE SCANNER
// Captures images of existing MRI film/screens.
// This does not acquire actual MRI medical data.
// ==================================================

function installCameraScanner() {
  if (!$("drop") || $("cameraScannerButton")) return;

  const style = document.createElement("style");

  style.textContent = `
    .mri-camera-launch {
      width: 100%;
      margin-top: 14px;
      padding: 15px 18px;
      border: 1px solid rgba(104,220,233,.55);
      border-radius: 12px;
      color: #baf8ff;
      background: linear-gradient(110deg,#10354a,#10243c);
      font-weight: 800;
      letter-spacing: 1px;
      cursor: pointer;
    }

    .mri-camera-launch:hover {
      background: #17445b;
      box-shadow: 0 0 22px rgba(104,220,233,.16);
    }

    .mri-camera-panel {
      display: none;
      margin-top: 20px;
      padding: 18px;
      border: 1px solid rgba(104,220,233,.3);
      border-radius: 16px;
      background: #081827;
      color: #e8f7ff;
    }

    .mri-camera-panel.active {
      display: block;
    }

    .mri-camera-panel h3 {
      margin: 0 0 8px;
      color: #9ceefa;
    }

    .mri-camera-description {
      color: #a7bdcb;
      font-size: 13px;
      line-height: 1.6;
    }

    .mri-camera-stage {
      position: relative;
      width: 100%;
      overflow: hidden;
      margin-top: 16px;
      border: 1px solid #28546b;
      border-radius: 12px;
      background: #020a12;
      aspect-ratio: 16/9;
    }

    .mri-camera-stage video {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .mri-camera-placeholder {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: #8da9ba;
      font-size: 13px;
      text-align: center;
      padding: 20px;
    }

    .mri-scan-line {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 3px;
      background: #50f5ff;
      box-shadow: 0 0 12px #50f5ff,0 0 28px #50f5ff;
      pointer-events: none;
      display: none;
    }

    .mri-scan-line::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      top: 3px;
      height: 35px;
      background: linear-gradient(
        to bottom,
        rgba(80,245,255,.18),
        transparent
      );
    }

    .mri-camera-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 9px;
      margin-top: 15px;
    }

    .mri-camera-controls button {
      padding: 11px 15px;
      border: 1px solid #315a70;
      border-radius: 9px;
      background: #112b40;
      color: #e7faff;
      cursor: pointer;
      font-weight: 700;
    }

    .mri-camera-controls button:disabled {
      opacity: .4;
      cursor: not-allowed;
    }

    .mri-camera-controls .mri-primary {
      background: #07586b;
      border-color: #37d9ec;
    }

    .mri-camera-status {
      margin-top: 12px;
      color: #72e3ed;
      font-size: 13px;
      min-height: 20px;
    }

    .mri-camera-gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill,minmax(145px,1fr));
      gap: 12px;
      margin-top: 16px;
    }

    .mri-frame-card {
      padding: 9px;
      border: 1px solid #29465a;
      border-radius: 10px;
      background: #0d2030;
      min-width: 0;
    }

    .mri-frame-card img {
      width: 100%;
      display: block;
      border-radius: 6px;
      aspect-ratio: 4/3;
      object-fit: contain;
      background: #02080d;
    }

    .mri-frame-card small {
      display: block;
      margin: 8px 0;
      color: #a9c5d4;
      font-size: 11px;
    }

    .mri-frame-card button {
      width: 100%;
      margin-top: 5px;
      padding: 8px;
      border-radius: 7px;
      border: 1px solid #326176;
      background: #102e42;
      color: #c9f5ff;
      cursor: pointer;
      font-size: 11px;
    }

    .mri-camera-warning {
      margin-top: 15px;
      padding: 12px;
      border-left: 3px solid #e5b96b;
      background: rgba(229,185,107,.08);
      color: #e8d2a9;
      font-size: 12px;
      line-height: 1.6;
    }
  `;

  document.head.appendChild(style);

  const launch = document.createElement("button");

  launch.id = "cameraScannerButton";
  launch.type = "button";
  launch.className = "mri-camera-launch";
  launch.textContent = "▤  OPEN WEBCAM MRI AUTOMATIC LINE SCANNER";

  const panel = document.createElement("section");

  panel.id = "mriCameraPanel";
  panel.className = "mri-camera-panel";

  panel.innerHTML = `
    <h3>WEBCAM MRI CAPTURE SYSTEM</h3>

    <p class="mri-camera-description">
      Position an existing MRI film or MRI image displayed on a monitor
      in front of the camera. The moving line guides the automatic
      frame-capture sequence.
    </p>

    <div class="mri-camera-stage">
      <video id="mriCameraVideo" autoplay muted playsinline></video>

      <div id="mriCameraPlaceholder" class="mri-camera-placeholder">
        Camera preview will appear here after permission is granted.
      </div>

      <div id="mriScanLine" class="mri-scan-line"></div>
    </div>

    <div class="mri-camera-controls">
      <button type="button" id="mriStartCamera" class="mri-primary">
        1 · START CAMERA
      </button>

      <button type="button" id="mriBeginScan" class="mri-primary" disabled>
        2 · START AUTO SCAN
      </button>

      <button type="button" id="mriPauseScan" disabled>
        PAUSE
      </button>

      <button type="button" id="mriStopScan" disabled>
        STOP
      </button>

      <button type="button" id="mriClearFrames">
        CLEAR CAPTURES
      </button>
    </div>

    <div id="mriCameraStatus" class="mri-camera-status">
      CAMERA STANDBY
    </div>

    <div class="mri-camera-warning">
      IMPORTANT: This feature photographs an existing MRI image or film.
      It does not perform MRI scanning, recover original DICOM data,
      reconstruct anatomical slices, or provide a medical diagnosis.
      Camera photographs may lose image detail and must not replace
      the original MRI files.
    </div>

    <h3 style="margin-top:22px">CAPTURED FRAME GALLERY</h3>

    <p class="mri-camera-description">
      Each captured frame can be downloaded or selected for the existing
      image-analysis workflow.
    </p>

    <div id="mriCameraGallery" class="mri-camera-gallery"></div>
  `;

  $("drop").insertAdjacentElement("afterend", launch);
  launch.insertAdjacentElement("afterend", panel);

  cameraElements = {
    panel,
    launch,
    video: $("mriCameraVideo"),
    placeholder: $("mriCameraPlaceholder"),
    line: $("mriScanLine"),
    status: $("mriCameraStatus"),
    gallery: $("mriCameraGallery"),
    startCamera: $("mriStartCamera"),
    beginScan: $("mriBeginScan"),
    pauseScan: $("mriPauseScan"),
    stopScan: $("mriStopScan"),
    clearFrames: $("mriClearFrames")
  };

  launch.addEventListener("click", () => {
    panel.classList.toggle("active");

    if (panel.classList.contains("active")) {
      panel.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
      });
    }
  });

  cameraElements.startCamera.addEventListener(
    "click",
    startCamera
  );

  cameraElements.beginScan.addEventListener(
    "click",
    beginAutomaticScan
  );

  cameraElements.pauseScan.addEventListener(
    "click",
    toggleScanPause
  );

  cameraElements.stopScan.addEventListener(
    "click",
    stopAutomaticScan
  );

  cameraElements.clearFrames.addEventListener(
    "click",
    clearCapturedFrames
  );

  window.addEventListener("beforeunload", stopCamera);
}

// --------------------------------------------------
// START WEBCAM
// --------------------------------------------------

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    cameraElements.status.textContent =
      "CAMERA NOT AVAILABLE · USE HTTPS OR A SUPPORTED BROWSER";

    return;
  }

  try {
    cameraElements.startCamera.disabled = true;
    cameraElements.status.textContent =
      "REQUESTING CAMERA PERMISSION…";

    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });

    cameraElements.video.srcObject = cameraStream;

    await cameraElements.video.play();

    cameraRunning = true;

    cameraElements.placeholder.style.display = "none";
    cameraElements.line.style.display = "block";

    cameraElements.beginScan.disabled = false;
    cameraElements.startCamera.textContent = "CAMERA CONNECTED";

    cameraElements.status.textContent =
      "CAMERA READY · POSITION MRI FILM OR DISPLAY IN VIEW";

  } catch (error) {
    cameraRunning = false;
    cameraElements.startCamera.disabled = false;

    cameraElements.status.textContent =
      "CAMERA ERROR · " + error.message;

    showMessage(
      "Unable to access webcam. Check browser camera permission.",
      true
    );
  }
}

// --------------------------------------------------
// AUTOMATIC LINE SCAN
// --------------------------------------------------

function beginAutomaticScan() {
  if (!cameraRunning || !cameraElements.video.videoWidth) {
    cameraElements.status.textContent =
      "START THE CAMERA AND WAIT FOR THE PREVIEW FIRST.";

    return;
  }

  if (scanRunning) return;

  scanRunning = true;
  scanPaused = false;
  scanLinePosition = 0;

  cameraElements.line.style.top = "0%";

  cameraElements.beginScan.disabled = true;
  cameraElements.pauseScan.disabled = false;
  cameraElements.stopScan.disabled = false;

  cameraElements.pauseScan.textContent = "PAUSE";

  cameraElements.status.textContent =
    "AUTOMATIC CAPTURE RUNNING · 12 FRAME TARGET";

  let lastFrameTime = 0;

  const duration = 18000;
  const maximumFrames = 12;
  const startTime = performance.now();

  function animateScan(now) {
    if (!scanRunning) return;

    if (scanPaused) {
      scanAnimation = requestAnimationFrame(animateScan);
      return;
    }

    const elapsed = now - startTime;
    const progress = Math.min(
      ((elapsed / duration) * 100) % 100,
      100
    );

    scanLinePosition = progress;

    cameraElements.line.style.top =
      scanLinePosition + "%";

    if (
      now - lastFrameTime >= 1500 &&
      capturedFrames.length < maximumFrames
    ) {
      lastFrameTime = now;
      captureCameraFrame();
    }

    if (elapsed >= duration || capturedFrames.length >= maximumFrames) {
      stopAutomaticScan();

      cameraElements.status.textContent =
        "SCAN SEQUENCE COMPLETE · " +
        capturedFrames.length +
        " FRAMES CAPTURED";

      return;
    }

    scanAnimation = requestAnimationFrame(animateScan);
  }

  scanAnimation = requestAnimationFrame(animateScan);
}

// --------------------------------------------------
// PAUSE / RESUME
// --------------------------------------------------

function toggleScanPause() {
  if (!scanRunning) return;

  scanPaused = !scanPaused;

  cameraElements.pauseScan.textContent =
    scanPaused ? "RESUME" : "PAUSE";

  cameraElements.status.textContent = scanPaused
    ? "SCAN PAUSED · CAMERA STILL ACTIVE"
    : "AUTOMATIC CAPTURE RESUMED";
}

// --------------------------------------------------
// CAPTURE CAMERA FRAME
// --------------------------------------------------

function captureCameraFrame() {
  if (!cameraRunning || !cameraElements.video.videoWidth) {
    return;
  }

  const video = cameraElements.video;

  const canvas = document.createElement("canvas");

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const context = canvas.getContext("2d");

  if (!context) return;

  context.drawImage(
    video,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const imageData = canvas.toDataURL("image/jpeg", 0.92);

  const index = capturedFrames.length + 1;

  const frame = {
    id: Date.now() + "-" + index,
    name: "MRI-Camera-Frame-" + String(index).padStart(2, "0") + ".jpg",
    dataUrl: imageData,
    width: canvas.width,
    height: canvas.height,
    time: new Date().toLocaleTimeString()
  };

  capturedFrames.push(frame);

  renderCapturedGallery();

  cameraElements.status.textContent =
    "CAPTURED FRAME " +
    index +
    " / 12 · " +
    canvas.width +
    " × " +
    canvas.height;
}

// --------------------------------------------------
// RENDER CAPTURED FRAME GALLERY
// --------------------------------------------------

function renderCapturedGallery() {
  cameraElements.gallery.innerHTML = capturedFrames
    .map((frame, index) => `
      <div class="mri-frame-card">
        <img
          src="${frame.dataUrl}"
          alt="Captured camera frame ${index + 1}"
        >

        <small>
          FRAME ${index + 1}<br>
          ${escapeHtml(frame.time)}<br>
          ${frame.width} × ${frame.height}
        </small>

        <button
          type="button"
          data-frame-download="${index}"
        >
          DOWNLOAD IMAGE
        </button>

        <button
          type="button"
          data-frame-use="${index}"
        >
          USE FOR MRI ANALYSIS
        </button>
      </div>
    `)
    .join("");

  cameraElements.gallery
    .querySelectorAll("[data-frame-download]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const frame = capturedFrames[
          Number(button.dataset.frameDownload)
        ];

        downloadCapturedFrame(frame);
      });
    });

  cameraElements.gallery
    .querySelectorAll("[data-frame-use]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const frame = capturedFrames[
          Number(button.dataset.frameUse)
        ];

        useCapturedFrame(frame);
      });
    });
}

// --------------------------------------------------
// DOWNLOAD CAPTURED IMAGE
// --------------------------------------------------

function downloadCapturedFrame(frame) {
  if (!frame) return;

  const link = document.createElement("a");

  link.href = frame.dataUrl;
  link.download = frame.name;

  document.body.appendChild(link);
  link.click();
  link.remove();
}

// --------------------------------------------------
// SELECT CAPTURE FOR EXISTING MRI ANALYSIS
// --------------------------------------------------

function useCapturedFrame(frame) {
  if (!frame) return;

  try {
    const binary = atob(frame.dataUrl.split(",")[1]);

    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const file = new File(
      [bytes],
      frame.name,
      { type: "image/jpeg" }
    );

    const transfer = new DataTransfer();

    transfer.items.add(file);

    $("scanFile").files = transfer.files;

    setFile(file);

    showMessage(
      "Captured camera frame selected. You can now Inspect or run the existing research analysis."
    );

    $("scanFile").scrollIntoView({
      behavior: "smooth",
      block: "center"
    });

  } catch (error) {
    showMessage(
      "Unable to select this captured frame: " + error.message,
      true
    );
  }
}

// --------------------------------------------------
// STOP AUTOMATIC SCAN
// --------------------------------------------------

function stopAutomaticScan() {
  scanRunning = false;
  scanPaused = false;

  if (scanAnimation) {
    cancelAnimationFrame(scanAnimation);
    scanAnimation = null;
  }

  if (!cameraElements) return;

  cameraElements.beginScan.disabled = !cameraRunning;
  cameraElements.pauseScan.disabled = true;
  cameraElements.stopScan.disabled = true;

  cameraElements.pauseScan.textContent = "PAUSE";

  if (cameraRunning) {
    cameraElements.status.textContent =
      "SCAN STOPPED · " +
      capturedFrames.length +
      " FRAMES AVAILABLE";
  }
}

// --------------------------------------------------
// CLEAR GALLERY
// --------------------------------------------------

function clearCapturedFrames() {
  if (scanRunning) {
    stopAutomaticScan();
  }

  capturedFrames = [];

  cameraElements.gallery.innerHTML = "";

  cameraElements.status.textContent =
    "CAPTURE GALLERY CLEARED";
}

// --------------------------------------------------
// STOP WEBCAM AND RELEASE CAMERA
// --------------------------------------------------

function stopCamera() {
  stopAutomaticScan();

  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => {
      track.stop();
    });

    cameraStream = null;
  }

  cameraRunning = false;

  if (cameraElements) {
    cameraElements.video.srcObject = null;
  }
}

// --------------------------------------------------
// INITIALIZE CAMERA SCANNER AND BOTH BACKENDS
// --------------------------------------------------

installCameraScanner();

checkBackend();
checkMobileNetBackend();
