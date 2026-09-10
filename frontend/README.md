# Metrivia Frontend

React + Vite + Tailwind CSS v4 application shell. The CSV upload flow sends
files to the Flask backend (`POST /api/upload`) and renders the returned
dataset analysis in the dashboard. All backend calls live in
`src/lib/api.js` — components never call `fetch()` directly.

## Run locally

```powershell
npm install
npm run dev
```

The app is served at `http://localhost:5173`.

## Backend API setup

Copy the example env file and adjust if Flask runs elsewhere:

```powershell
Copy-Item .env.example .env
```

`.env` files are git-ignored (see root `.gitignore`) — only `.env.example`
is committed.

| Variable       | Default                 | Purpose                              |
| -------------- | ----------------------- | ------------------------------------ |
| `VITE_API_URL` | `http://localhost:5000` | Base URL of the Flask backend        |

Without a `.env` file, the app uses the default above. For a production
build against Render, set `VITE_API_URL` at build time — never hardcode the
production URL into components.

Start Flask first (see `../backend/README.md`), then upload
`public/sample.csv` through the UI to try the full flow.

## Scripts

- `npm run dev` — start the dev server
- `npm run lint` — run ESLint
- `npm run build` — production build
