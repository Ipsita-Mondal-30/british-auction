# Deploying

| Piece | Where | How |
|---|---|---|
| PostgreSQL | Render Postgres | Created by the Blueprint (`render.yaml`) |
| API (FastAPI + Socket.IO) | Render web service | Created by the same Blueprint |
| Frontend (Next.js) | Vercel | Vercel CLI, straight from the `frontend/` folder |

Total time: about 15 minutes.

**Why the database is on Render:** the API and database share a region and private network, one Blueprint creates both, and the connection string is wired in automatically. Supabase works too; see [Using Supabase instead](#using-supabase-instead).

> **Render needs a Git repo.** Render only deploys from GitHub, GitLab or Bitbucket (or a Docker image). The Render CLI can validate, deploy and inspect, but it can't upload a local folder. If you received this as a zip, step 1 puts it on GitHub. Vercel has no such limit.

## 0. Prerequisites

- Python 3.12 (to load the demo data from your machine)
- Node 20+ and npm (for the Vercel CLI)
- Accounts on GitHub, Render and Vercel
- CLIs:

```bash
brew install render        # or see https://render.com/docs/cli
npm i -g vercel
render login               # opens the browser
vercel login
```

## 1. Put the code on GitHub

```bash
unzip british-auction.zip && cd british-auction
git init && git add -A && git commit -m "British auction RFQ system"
gh repo create british-auction --private --source . --push   # or create the repo on github.com and push
```

`.gitignore` already excludes `node_modules`, `.venv`, build output and `.env` files.

## 2. Create the database and API on Render

Check the Blueprint first:

```bash
render blueprints validate render.yaml
```

Then create it. Either:

- **Dashboard:** go to New > Blueprint, pick the repo and click Apply. Or
- **One link:** open `https://render.com/deploy?repo=https://github.com/<you>/british-auction`

When asked for `FRONTEND_ORIGIN`, enter `http://localhost:3000` for now. You'll set the real value in step 5.

Render now creates `british-auction-db` (Postgres) and `british-auction-api`. It runs migrations automatically on start (`alembic upgrade head` in the start command). Wait for the deploy to go live, then:

```bash
render services                     # note the API's URL and service id
curl https://<api>.onrender.com/api/health
# {"ok":true,"serverNow":"..."}
```

**Plans:** `render.yaml` uses paid plans (`starter` API, `basic-256mb` database), so the API never sleeps and WebSockets stay connected. For a zero-cost demo, change both `plan:` values to `free`, commit and push. The free API sleeps after 15 minutes idle, and the free database expires after 30 days.

## 3. Load the demo data

The seed creates 1 buyer, 4 suppliers and 5 RFQs, with times relative to now. It **wipes all tables**, which is why it asks for `--force` on any non-local database.

In the Render dashboard, open the database and copy the **External Database URL**. Then run:

```bash
cd backend-py
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
DATABASE_URL="<External Database URL>" .venv/bin/python -m app.seed --force
```

Re-run it any time to reset the demo clock.

## 4. Deploy the frontend to Vercel

```bash
cd frontend
vercel link                                      # create/link a project; accept the detected Next.js settings
printf 'https://<api>.onrender.com' | vercel env add NEXT_PUBLIC_API_URL production
vercel --prod
```

Note the production URL it prints, e.g. `https://british-auction.vercel.app`.

`NEXT_PUBLIC_API_URL` is baked in at build time. If you change it, run `vercel --prod` again.

## 5. Allow the frontend on the API

In the Render dashboard, go to `british-auction-api` > Environment and set:

```
FRONTEND_ORIGIN=https://british-auction.vercel.app
```

To allow several origins, separate them with commas (for example, add a preview URL). Saving triggers a redeploy. To redeploy manually:

```bash
render deploys create <api-service-id> --wait
```

## 6. Check it

1. Open the Vercel URL and sign in as **Priya Sharma (buyer)**.
2. Open `RFQ-1001`, which is in its extension window right after seeding.
3. In a second tab, sign in as a supplier and bid below L1. The buyer's tab should update live and show a toast, and the close time should extend.

## Using Supabase instead

1. Create a Supabase project. Under Project Settings > Database, copy a connection string that works with migrations: the **direct connection** (port 5432) or the **session pooler**, not the transaction pooler on port 6543. Append `?sslmode=require`.
2. In `render.yaml`, delete the `databases:` block and replace the `DATABASE_URL` entry with:
   ```yaml
   - key: DATABASE_URL
     sync: false
   ```
3. Create the Blueprint as in step 2 and paste the Supabase URL when asked. Seed with that same URL (step 3).

Supabase's free tier doesn't expire, which makes it the better choice if the demo must stay up long-term without paying.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Browser console shows a CORS error, or the login list never loads | `FRONTEND_ORIGIN` on Render must exactly match the Vercel URL (scheme included, no trailing slash) |
| Page loads but nothing updates live | Same as above (Socket.IO uses the same origin list), or the free API is waking from sleep; refresh after a minute |
| Frontend calls `localhost:4000` in production | `NEXT_PUBLIC_API_URL` wasn't set before the build. Add it and run `vercel --prod` again |
| The seed says "Refusing to reset a non-local database" | Expected. Add `--force` once you're sure the URL is the demo database |
| Deploy fails at `alembic upgrade head` | Check `DATABASE_URL`. For Supabase, use the direct or session connection, not port 6543 |
| Deploy fails with `type "Role" already exists` | The database was set up by the earlier Node/Prisma version of the API. Record it as migrated once, then redeploy: `DATABASE_URL="<External Database URL>" .venv/bin/alembic stamp 0001` (in `backend-py`) |
| `render` command not found | Install the Render CLI: https://render.com/docs/cli |

## Sharing as a zip

```bash
scripts/make-zip.sh      # writes ../british-auction.zip without node_modules, builds or .env files
```
