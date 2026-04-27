#!/usr/bin/env bash
set -euo pipefail

echo "== PayrollPH DigitalOcean deploy helper =="

if [[ ! -f "package.json" ]]; then
  echo "Run this script from repository root."
  exit 1
fi

required_env=(
  "DATABASE_URL"
  "NEXTAUTH_URL"
  "NEXTAUTH_SECRET"
)

missing=0
for key in "${required_env[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required env: $key"
    missing=1
  fi
done

if [[ "$missing" -eq 1 ]]; then
  echo "Aborting: set required environment variables first."
  exit 1
fi

if [[ "${DATABASE_URL}" != *"sslmode=require"* ]]; then
  echo "Warning: DATABASE_URL does not include sslmode=require."
  echo "For DO Managed Postgres, SSL is usually required."
fi

echo "1) Installing dependencies..."
npm ci

echo "2) Generating Prisma client..."
npm run db:generate

echo "3) Syncing Prisma schema to database..."
npm run db:push

echo "4) Building Next.js app..."
npm run build

echo "5) Running lightweight API checks..."
base_url="${DEPLOY_BASE_URL:-${NEXTAUTH_URL%/}}"

curl -fsS "${base_url}/api/auth/me" >/dev/null || true
curl -fsS -X POST "${base_url}/api/auth/register-first-admin" \
  -H "Content-Type: application/json" \
  -d '{"email":"healthcheck@example.com","password":"dont-use-this","name":"Healthcheck"}' >/dev/null || true

echo "Deploy helper complete."
echo "Next steps:"
echo "- Start app process (pm2/systemd or App Platform runtime)"
echo "- Run: bash scripts/postdeploy-check.sh ${base_url}"
