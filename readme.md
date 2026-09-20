# Metrivia

Responsive CSV data visualization application.

- `frontend/` — React + Vite + Tailwind CSS application shell (landing/upload
  page and dashboard layout).
- `backend/` — lightweight Flask + Pandas analytics API (see
  `backend/README.md`).

## Run the backend locally (Flask)

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Health check: `GET http://127.0.0.1:5000/api/health`
Upload: `POST http://127.0.0.1:5000/api/upload` with a CSV file as
multipart form field `file`.

Configuration via environment variables: `HOST`, `PORT`, `CORS_ORIGINS`,
`MAX_UPLOAD_MB`, `FLASK_DEBUG`. Details in `backend/README.md`.

## Run the frontend locally

```powershell
cd frontend
npm install
npm run dev
```

## Deployment (Vercel frontend + Render backend)

1. Commit and push this repo to GitHub.
2. **Backend → Render:** New → Blueprint → select the repo (`render.yaml`
   defines the `metrivia-backend` web service, free plan, stateless). In the
   Render dashboard set `CORS_ORIGINS` to the production Vercel URL, e.g.
   `https://metrivia.vercel.app`. Note the backend URL, e.g.
   `https://metrivia-backend.onrender.com`.
3. **Frontend → Vercel:** import the repo, set Root Directory to `frontend`,
   and add environment variable
   `VITE_API_URL=https://metrivia-backend.onrender.com` (your real backend
   URL — never localhost for production). Deploy.
4. Verify: frontend loads, `GET <backend>/api/health` responds, upload
    `frontend/public/sample.csv` through production, chart renders, no CORS
    errors in the console. Production contracts, logging, and the
    deployment checklist live in `backend/README.md` ("Production
    hardening (Phase M6)").
