const $ = (id) => document.getElementById(id);
const API = (window.MRI_API_BASE || "").replace(/\/$/, "");
let selectedFile = null;
let localPreview = null;

function showMessage(text, error=false) {
  $("message").textContent = text;
  $("message").style.color = error ? "#ff9b9b" : "#68dce9";
}
function api(path) {
  if (!API) throw new Error("Backend URL is not configured. Set MRI_API_BASE in frontend/config.js and redeploy Vercel.");
  return API + path;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
async function checkBackend() {
  try {
    const response = await fetch(api("/api/mri/status"));
    if (!response.ok) throw new Error("HTTP " + response.status);
    const state = await response.json();
    $("backendStatus").textContent = state.classifier_loaded ? "● API ONLINE · MODEL LOADED" : "● API ONLINE · SCAN VIEWER READY";
    $("backendStatus").style.color = "#75e0b3";
  } catch (error) {
    $("backendStatus").textContent = "● BACKEND NOT CONNECTED";
    $("backendStatus").style.color = "#e5b96b";
  }
}
function setFile(file) {
  selectedFile = file || null;
  $("fileName").textContent = selectedFile ? `${selectedFile.name} · ${(selectedFile.size/1048576).toFixed(2)} MB` : "No file selected · 80 MB maximum";
  const valid = selectedFile && selectedFile.size > 0 && selectedFile.size <= 80*1024*1024;
  $("inspect").disabled = !valid;
  $("analyze").disabled = !valid;
  if (localPreview) URL.revokeObjectURL(localPreview);
  localPreview = null;
  if (selectedFile && /\.(png|jpe?g)$/i.test(selectedFile.name)) {
    localPreview = URL.createObjectURL(selectedFile);
    $("viewport").innerHTML = `<img src="${localPreview}" alt="Local scan preview">`;
    $("previewStatus").textContent = "LOCAL PREVIEW";
  } else {
    $("viewport").innerHTML = '<div class="empty"><b>＋</b><span>Click Inspect scan to generate preview</span></div>';
    $("previewStatus").textContent = "AWAITING INSPECTION";
  }
  if (selectedFile && !valid) showMessage("Please choose a non-empty file no larger than 80 MB.", true);
  else showMessage("");
}
$("scanFile").addEventListener("change", event => setFile(event.target.files[0]));
$("drop").addEventListener("dragover", event => { event.preventDefault(); $("drop").style.borderColor = "#68dce9"; });
$("drop").addEventListener("dragleave", () => $("drop").style.borderColor = "");
$("drop").addEventListener("drop", event => {
  event.preventDefault(); $("drop").style.borderColor = "";
  const file = event.dataTransfer.files[0]; if (!file) return;
  const transfer = new DataTransfer(); transfer.items.add(file); $("scanFile").files = transfer.files; setFile(file);
});
async function submitScan(path, button) {
  if (!selectedFile) return null;
  const previous = button.innerHTML;
  button.disabled = true; button.textContent = "Processing…";
  try {
    const body = new FormData(); body.append("file", selectedFile);
    const response = await fetch(api(path), {method:"POST", body});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
    return data;
  } finally {
    button.disabled = false; button.innerHTML = previous;
  }
}
$("inspect").addEventListener("click", async () => {
  showMessage("Sending scan for inspection…");
  try {
    const data = await submitScan("/api/mri/inspect", $("inspect"));
    $("viewport").innerHTML = `<img src="${data.preview}" alt="Generated MRI preview">`;
    $("previewStatus").textContent = "PREVIEW GENERATED";
    const entries = Object.entries(data.metadata || {});
    $("metadata").innerHTML = entries.map(([key,value]) => `<div class="meta-item"><span>${escapeHtml(key.replaceAll("_"," "))}</span><b>${escapeHtml(Array.isArray(value) ? value.join(" × ") : value)}</b></div>`).join("");
    const m = data.metadata || {};
    $("dimensions").textContent = m.width_px ? `${m.width_px} × ${m.height_px} PX` : m.rows ? `${m.columns} × ${m.rows} PX` : (m.dimensions || []).join(" × ") || "SCAN INSPECTED";
    showMessage(data.message || "Scan inspection complete.");
  } catch (error) { showMessage(error.message, true); }
});
$("analyze").addEventListener("click", async () => {
  showMessage("Submitting scan to the research inference endpoint…");
  try {
    const data = await submitScan("/api/mri/analyze", $("analyze"));
    const predictions = data.research_result?.predictions || [];
    $("analysis").innerHTML = `<p>Experimental model output only — not a diagnosis.</p>` + predictions.map(item => `<div class="prediction"><b>${escapeHtml(item.label)}</b><span>${(item.probability*100).toFixed(1)}%</span></div>`).join("");
    showMessage(data.notice || "Research inference complete.");
  } catch (error) {
    $("analysis").innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    showMessage(error.message, true);
  }
});
checkBackend();
