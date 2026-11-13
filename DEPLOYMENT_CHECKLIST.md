# Deployment checklist

- [ ] Create a new empty GitHub repo: `brain-mri-intelligence`.
- [ ] Upload/push the contents of this folder to the repo root.
- [ ] Create Render Web Service from this repo using the README build/start commands.
- [ ] Verify `/api/health` returns `{"status":"ok"...}`.
- [ ] Edit `frontend/config.js` with the exact Render URL and push the change.
- [ ] Import repo to Vercel with root directory `frontend`, preset Other, output `.`.
- [ ] Set Render `ALLOWED_ORIGINS` to the exact Vercel deployment origin and redeploy.
- [ ] Test with a de-identified PNG/JPG sample first; then test DICOM/NIfTI if codecs and data formats are available.
- [ ] Do not enable public patient uploads until authentication and privacy safeguards are implemented.
