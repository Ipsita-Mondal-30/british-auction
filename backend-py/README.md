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

Load the demo data (1 buyer, 4 suppliers, 5 RFQs, times relative to now). It wipes every table, so it refuses a non-local database unless you add `--force`:

```bash
.venv/bin/python -m app.seed
```

To point the frontend at it, set `NEXT_PUBLIC_API_URL=http://localhost:4001` in `frontend/.env.local` and add the frontend's origin to `FRONTEND_ORIGIN` here.

## Database migrations

Alembic manages the schema. Its first migration, `0001`, creates exactly the tables the Prisma migration created, so both backends share one database.

```bash
.venv/bin/alembic upgrade head    # empty database: create the tables
.venv/bin/alembic stamp 0001      # database Prisma already set up: record it as migrated, change nothing
.venv/bin/alembic check           # confirm app/models.py matches the database
```

## Tests

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest
```

## Layout

| Path | |
|---|---|
| `app/main.py` | FastAPI app, CORS, mounts Socket.IO |
| `app/realtime.py` | Socket.IO rooms (`list`, `rfq:<id>`) and the `rfq:updated` broadcast |
| `app/validation.py` | Request validation with the same rules and messages as the Node API |
| `app/auction.py` | Pure auction rules: ranking, trigger window, triggers, extension cap, status |
| `app/routes.py` | REST routes under `/api`, mock auth (`x-user-id`), buyer and supplier views |
| `app/serialize.py` | Rows to JSON in the same shape as the Node API (camelCase, ISO timestamps, money strings) |
| `app/errors.py` | `{ error, issues? }` error responses |
| `app/models.py` | SQLAlchemy models for the shared tables (`User`, `Rfq`, `Bid`, `AuctionEvent`) |
| `app/db.py` | Async database engine and sessions (asyncpg) |
| `alembic/` | Schema migrations |
| `app/seed.py` | Demo data |
| `app/config.py` | `DATABASE_URL`, `FRONTEND_ORIGIN`, `PORT` from env or `.env` |
| `app/timefmt.py` | Timestamps in the same format as the Node API |
| `tests/` | pytest unit tests for the auction rules |
