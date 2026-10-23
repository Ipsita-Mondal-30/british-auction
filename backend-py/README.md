# Backend (Python / FastAPI)

REST API under `/api` and Socket.IO live updates for the British auction RFQ system. API docs: Swagger UI at `/docs`, ReDoc at `/redoc`, OpenAPI 3.1 spec at `/openapi.json`.

## Run locally

```bash
cd backend-py
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env          # set DATABASE_URL to your local Postgres
.venv/bin/alembic upgrade head
.venv/bin/python -m app       # http://localhost:4000, auto-reloads
```

Load the demo data (1 buyer, 4 suppliers, 5 RFQs, times relative to now). It wipes every table, so it refuses a non-local database unless you add `--force`:

```bash
.venv/bin/python -m app.seed
```

If the frontend runs on a port other than 3000, add its origin to `FRONTEND_ORIGIN` in `.env` (comma-separated).

## Database migrations

Alembic manages the schema. Migration `0001` creates the four tables; `0002` adds CHECK constraints for timestamp order and money invariants.

```bash
.venv/bin/alembic upgrade head    # empty database: create the tables
.venv/bin/alembic check           # confirm app/models.py matches the database
```

A database created by the earlier Node/Prisma version of this API already has the tables. Record it as migrated once instead (this changes no data):

```bash
.venv/bin/alembic stamp 0001
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
| `app/routes.py` | REST routes under `/api`, mock auth (`x-user-id`), buyer and supplier views, bid transaction |
| `app/validation.py` | Request validation and field error messages |
| `app/auction.py` | Pure auction rules: ranking, trigger window, extension strategies (one class per trigger), extension cap, status |
| `app/serialize.py` | Rows to JSON (camelCase, ISO timestamps, money strings) |
| `app/openapi.py` | API docs: overview text, tags, error examples; drops FastAPI's default 422 (the API uses 400) |
| `app/schemas.py` | Documentation-only request/response models for Swagger UI (they never change what the API accepts or returns) |
| `app/errors.py` | `{ error, issues? }` error responses |
| `app/models.py` | SQLAlchemy models (`User`, `Rfq`, `Bid`, `AuctionEvent`) |
| `app/db.py` | Async database engine and sessions (asyncpg) |
| `alembic/` | Schema migrations |
| `app/seed.py` | Demo data |
| `app/config.py` | `DATABASE_URL`, `FRONTEND_ORIGIN`, `PORT` from env or `.env` |
| `app/timefmt.py` | Timestamps in JavaScript's ISO format |
| `tests/` | pytest unit tests for the auction rules |
