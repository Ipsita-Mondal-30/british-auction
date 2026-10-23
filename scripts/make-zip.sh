#!/usr/bin/env bash
# Builds a clean, shareable zip: no node_modules, Python virtualenvs or caches, build output, secrets or local env files.
# Usage: scripts/make-zip.sh  ->  <parent folder>/british-auction.zip
set -euo pipefail
cd "$(dirname "$0")/.."
name="$(basename "$PWD")"
out="$(cd .. && pwd)/${name}.zip"
rm -f "$out"
(cd .. && zip -rq "$out" "$name" \
  -x "$name/*node_modules/*" "$name/*/.next/*" "$name/*/dist/*" "$name/*.DS_Store" \
     "$name/*/.env" "$name/*/.env.local" "$name/.env" "$name/*/.vercel/*" "$name/*.tsbuildinfo" \
     "$name/*/.venv/*" "$name/*__pycache__/*" "$name/*/.pytest_cache/*" "$name/.git/*")
echo "Created $out ($(du -h "$out" | cut -f1))"
# Fail loudly if a secret slipped in.
if unzip -l "$out" | grep -E '/\.env(\.local)?$'; then echo "ERROR: env file included" >&2; exit 1; fi
