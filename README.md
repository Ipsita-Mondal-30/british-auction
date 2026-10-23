# British Auction RFQ System

A freight RFQ platform with British auction (reverse auction) bidding. Suppliers keep lowering their quotes. Activity close to the end extends the auction, and a forced close time caps it.

- **Live demo:** [british-auction.vercel.app](https://british-auction.vercel.app) · API: [british-auction-api-zbjx.onrender.com](https://british-auction-api-zbjx.onrender.com/api/health)
- **Design docs:** [High-level design](docs/HLD.md) · [Database schema](docs/SCHEMA.md) · [Architecture diagram prompt](docs/ARCHITECTURE_DIAGRAM_PROMPT.md)

![Architecture](docs/architecture.png)

## What it does

| | Buyer | Supplier |
|---|---|---|
| Create RFQs with schedule, X/Y and trigger type | Yes | |
| See every quote ranked L1, L2, L3 with full charges | Yes | |
| Submit and lower quotes | | Yes |
| See own rank, own bids, the L1 price | | Yes |
| Live countdown, live extensions, activity log | Yes | Yes (competitors anonymized) |
| Toast notifications | New bids, extensions | Outbid, extensions, new RFQs, bid confirmations |
| Export ranked supplier list as CSV | Yes | |

**Auction rules:**
- Bids are accepted only while `start <= now < currentClose`.
- A bid inside the last **X** minutes that matches the configured trigger moves the close **Y** minutes later. The trigger is one of: any bid, any rank change, or an L1 change.
- The close never goes past the forced close time.
- Each new bid from a supplier must be lower than that supplier's previous bid.

## Assignment checklist

| Requirement (from the brief) | Status | Where |
|---|---|---|
| RFQ creation: name/reference ID, bid start, bid close, forced close, pickup/service date | Done | `frontend/app/auctions/new`, `POST /api/rfqs` |
| Quote form: carrier, freight/origin/destination charges, transit time, validity | Done | `frontend/components/BidForm.tsx`, `POST /api/rfqs/:id/bids` |
| Trigger window X, extension duration Y | Done | `backend/src/auction.ts` (`inTriggerWindow`, `extendClose`) |
| Triggers: bid received, any rank change, L1 change | Done | `detectTrigger` in `backend/src/auction.ts` |
| Forced close > bid close; extensions never exceed forced close | Done | zod refine in `routes.ts`; `extendClose` caps with `min()` |
| Listing: name/ID, current lowest bid, current close, forced close, status | Done | `frontend/app/auctions/page.tsx` |
| Details: ranked bids L1/L2/L3, every bid sorted by price, quote details, X/Y config, activity log with extension reasons | Done | `frontend/app/auctions/[id]/page.tsx` |
| HLD with architecture diagram | Done | `docs/HLD.md`, `docs/architecture.png` |
| Schema design | Done | `docs/SCHEMA.md`, `backend/prisma/schema.prisma` |
| Backend code, frontend code | Done | `backend/`, `frontend/` |

Beyond the brief: live updates over WebSockets, toast notifications, role-based visibility, a row lock per auction, server-synced countdowns and unit tests for the auction rules.

## Stack

| Layer | Tech | Hosting |
|---|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind v4, Phosphor icons, Sonner (toasts), socket.io-client | Vercel |
| Backend | Node 20, Express 5, TypeScript, Socket.IO, zod | Render |
| Database | PostgreSQL via Prisma 6 | Render Postgres |

Vercel can't hold WebSocket connections, so the realtime API runs on Render as a long-lived process.

```
backend/
  prisma/schema.prisma     schema (deliverable)
  prisma/seed.ts           demo data, times relative to now
  src/auction.ts           pure auction rules (ranking, triggers, extension, status)
  src/auction.test.ts      unit tests for the rules
  src/routes.ts            REST API, validation, bid transaction
  src/index.ts             Express + Socket.IO bootstrap
frontend/
  app/                     pages: login, listing, create, details
  components/              BidForm, shared UI
  components/LiveNotifications.tsx   app-wide toasts for auctions you are not viewing
  lib/                     API client, server-synced clock, socket hook, notify() toasts
docs/                      HLD and schema
```

## Run locally

Prerequisites: Node 20+, and either Docker or a local PostgreSQL.

```bash
# 1. Database (Docker; matches backend/.env.example)
docker compose up -d
#    or with a local Postgres: createdb british_auction, then edit DATABASE_URL in backend/.env

# 2. Backend (http://localhost:4000)
cd backend
cp .env.example .env
npm install
npx prisma migrate deploy
npm run seed                  # resets data: 1 buyer, 4 suppliers, 5 RFQs
npm run dev

# 3. Frontend (http://localhost:3000)
cd ../frontend
cp .env.example .env.local    # NEXT_PUBLIC_API_URL=http://localhost:4000
npm install
npm run dev
```

If the frontend runs on a port other than 3000, add that origin to `FRONTEND_ORIGIN` in `backend/.env` (comma-separated).

### Try it

1. Open the app and sign in as **Priya Sharma (buyer)**. Open `RFQ-1001`, which closes about 5 minutes after seeding and is already inside its 10-minute trigger window.
2. In a **second tab**, sign in as a supplier. Login is per tab, so both can be open side by side.
3. As the supplier, bid below the current L1. Both tabs update instantly: the close moves 5 minutes later, a notice explains why, and the activity log records the reason.
4. Other things to try: bid higher than your own last bid (rejected), bid on a closed RFQ (rejected), or create an RFQ with forced close before close (rejected inline).

Re-run `npm run seed` any time to reset the demo clock.

### Tests

```bash
cd backend && npm test    # auction rules
cd frontend && npm test   # CSV export escaping
```

The tests cover ranking and ties, the trigger window boundaries, each trigger type firing and not firing (including a bottom entrant and L1 undercutting themselves), the extension cap at forced close, close-time exclusivity and status derivation.

## API

All routes are under `/api`. Every route except `/health` and `/users` needs an `x-user-id` header (mock auth).

| Method | Path | Who | |
|---|---|---|---|
| GET | `/health` | any | `{ ok, serverNow }` |
| GET | `/users` | any | seeded users for the login screen |
| GET | `/rfqs` | any | listing with L1 price and derived status |
| POST | `/rfqs` | buyer | create an RFQ (validated) |
| GET | `/rfqs/:id` | any | details, shaped by role |
| POST | `/rfqs/:id/bids` | supplier | place a bid (row-locked transaction) |

Socket.IO: emit `join` with `list` or `rfq:<id>`, then listen for `rfq:updated { rfqId }` and refetch.

Errors look like `{ error, issues?: [{ path, message }] }`, with status codes 400 (validation), 401/403 (identity/role), 404, 409 (closed, not started, duplicate reference ID).

## Deploy

Render (Postgres + API, from [`render.yaml`](render.yaml)) and Vercel (frontend), using the Render and Vercel CLIs. Step-by-step, including the Supabase alternative and troubleshooting: **[DEPLOY.md](DEPLOY.md)**.

To share the project as a zip without `node_modules`, builds or secrets, run `scripts/make-zip.sh`.

## Assumptions

- **Mock auth**: pick a seeded user, and the client sends `x-user-id`. This isn't real security; it would be swapped for sessions or JWT in production.
- **Bid rule**: a new bid must beat the supplier's *own* previous bid, not L1. This keeps L2/L3 meaningful and the three trigger types distinct.
- **Extension** adds Y to the *current close time* (not to the bid time), per the spec example.
- **Rank change** means a previously ranked supplier moved. A newcomer at the bottom doesn't count. **L1 change** needs a previous L1, so the very first bid doesn't count.
- **Status** values: Upcoming, Active, Closed, Force Closed (the close hit the forced cap). The spec lists the last three; Upcoming covers before start.
- **Price** is freight + origin + destination charges, in INR. Ties go to the earlier bid.
- **Pickup date** must be on or after the forced close date. Quote validity can't be in the past.
- **Concurrency**: one Postgres row lock per RFQ. A bid is stamped with its arrival time, and the timer shown in the UI is display-only.

See [docs/HLD.md](docs/HLD.md) for the full design and edge-case reasoning.
