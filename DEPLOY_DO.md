# Deploying PayrollPH to DigitalOcean

This guide covers deploying `payrollph` to DigitalOcean with a managed PostgreSQL database.

## Recommended Architecture

- App host: DigitalOcean App Platform or Droplet
- Database: DigitalOcean Managed PostgreSQL
- Domain/DNS: Namecheap (or other registrar) pointed to DigitalOcean app

## 1) Create Managed PostgreSQL

1. In DigitalOcean: `Databases -> Create -> PostgreSQL`
2. Pick region close to app host.
3. Save these values from the DB dashboard:
   - host
   - port
   - database
   - user
   - password
4. Build your connection string:

```bash
postgresql://USER:PASSWORD@HOST:PORT/DBNAME?sslmode=require
```

## 2) Set Production Environment Variables

Set these on your app host (App Platform env vars or Droplet `.env`):

- `DATABASE_URL` = DO managed Postgres URL (with `sslmode=require`)
- `NEXTAUTH_URL` = public app URL (for example `https://payroll.example.com`)
- `NEXTAUTH_SECRET` = strong random value (32+ chars)

Optional:

- `PORT` (for manual droplet process manager setup)

Generate a secret quickly:

```bash
openssl rand -base64 32
```

## 3) Prepare and Deploy App

On your server (or CI):

```bash
npm ci
npm run db:push
npm run build
npm run preview
```

For long-running production on a Droplet, use `pm2` or `systemd` instead of a foreground process.

## 4) Domain and DNS (Namecheap)

Point your domain to the deployed app:

- App Platform: follow the domain records shown in DigitalOcean
- Droplet: set `A` record to Droplet public IP

After DNS propagates, verify `NEXTAUTH_URL` matches the final URL.

## 5) Bootstrap Super Admin (First Time Only)

After app is live:

```bash
curl -X POST https://YOUR_DOMAIN/api/auth/register-first-admin \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"change-me-now","name":"Admin"}'
```

## 6) Post-Deploy Verification

From repo root:

```bash
bash scripts/postdeploy-check.sh https://YOUR_DOMAIN
```

## Optional Helper Script

You can run:

```bash
bash scripts/deploy-do.sh
```

It validates required env vars, runs Prisma sync, builds, and performs quick health checks.

## Common Issues

- `P1001` cannot reach DB:
  - Check host/port/user/password
  - Ensure DB trusted sources include app host egress IP (if restricted)
- Auth redirects wrong host:
  - `NEXTAUTH_URL` must exactly match public URL
- SSL errors:
  - Ensure `?sslmode=require` in `DATABASE_URL`
