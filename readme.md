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
