# PayrollPH

Standalone payroll and HR app migrated from Base44 to:

- Next.js
- PostgreSQL
- Prisma
- NextAuth credentials authentication

## Setup

1. Install dependencies:

```bash
npm install
```

2. Start PostgreSQL:

```bash
docker compose up -d
```

If your Docker installation does not include Compose, run:

```bash
docker run --name payrollph-postgres \
  -e POSTGRES_DB=payrollph \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  -v payrollph-postgres:/var/lib/postgresql/data \
  -d postgres:16
```

3. Configure environment variables:

```bash
cp .env.example .env
```

Update `DATABASE_URL`, `NEXTAUTH_URL`, and `NEXTAUTH_SECRET` as needed.

4. Create/update the database schema:

```bash
npm run db:push
```

5. Start the app:

```bash
npm run dev
```

The app runs at http://localhost:3000.

## First Admin

Create the initial super admin after `db:push`:

```bash
curl -X POST http://localhost:3000/api/auth/register-first-admin \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"change-me-now","name":"Admin"}'
```

Then sign in at `/api/auth/signin`.

## Deployment Docs

- DigitalOcean deployment runbook: `DEPLOY_DO.md`
  - Open quickly: `sed -n '1,200p' DEPLOY_DO.md`
- Production env + Namecheap DNS template: `docs/ENV_PROD_EXAMPLE.md`
  - Open quickly: `sed -n '1,200p' docs/ENV_PROD_EXAMPLE.md`
- Post-deploy smoke checks: `scripts/postdeploy-check.sh`
  - Run checks: `bash scripts/postdeploy-check.sh https://YOUR_DOMAIN`

## Migration Notes

The first standalone pass uses a Prisma-backed `EntityRecord` table that preserves the existing Base44 entity payload shapes. This keeps the current React screens working while removing the Base44 runtime dependency. Once data is stable, the entities can be normalized into dedicated relational tables without rewriting the UI all at once.

Former Base44 functions now live under `pages/api/functions`, and frontend code calls the local API through `src/lib/appApi.js`.
