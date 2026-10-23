# Backend (Python / FastAPI)

FastAPI port of the Node backend in `../backend`. It serves the same REST routes under `/api` and the same Socket.IO events, so the frontend works with either.

## Run locally

```bash
cd backend-py
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env          # set DATABASE_URL to your local Postgres
.venv/bin/python -m app       # http://localhost:4001, auto-reloads
```

To point the frontend at it, set `NEXT_PUBLIC_API_URL=http://localhost:4001` in `frontend/.env.local` and add the frontend's origin to `FRONTEND_ORIGIN` here.

## Layout

| Path | |
|---|---|
| `app/main.py` | FastAPI app, CORS, Socket.IO rooms (`list`, `rfq:<id>`) |
| `app/routes.py` | REST routes under `/api` |
| `app/errors.py` | `{ error, issues? }` error responses |
| `app/config.py` | `DATABASE_URL`, `FRONTEND_ORIGIN`, `PORT` from env or `.env` |
| `app/timefmt.py` | Timestamps in the same format as the Node API |
