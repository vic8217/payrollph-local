# Production Environment Template (DigitalOcean + Namecheap)

Use this as a reference when configuring production variables and DNS.

## 1) Environment Variables

Set these in your production host (DigitalOcean App Platform or Droplet process manager).

```bash
# Required: managed Postgres URL
# Include sslmode=require for DigitalOcean managed DB.
DATABASE_URL="postgresql://doadmin:YOUR_PASSWORD@db-postgresql-xxx.db.ondigitalocean.com:25060/defaultdb?sslmode=require"

# Required: public canonical app URL (no trailing slash)
NEXTAUTH_URL="https://payroll.yourdomain.com"

# Required: random 32+ char secret
NEXTAUTH_SECRET="replace-with-long-random-secret"

# Optional: if your runtime needs explicit port
PORT="3000"

# Optional: persistent upload directory for logos/photos/files.
# Point this to a mounted persistent disk/volume in production.
# If omitted, uploads are stored in public/uploads inside the app directory.
UPLOAD_DIR="/var/lib/payrollph/uploads"

# Optional isolated module flag. Existing payroll, attendance, payslip, and auth flows
# do not require this module.
PAYROLLPH_FACE_VERIFICATION_ENABLED=false
PAYROLLPH_ACCURA_FACE_VERIFICATION_ENABLED=false
```

Generate a secret:

```bash
openssl rand -base64 32
```

## 2) Namecheap DNS Records

Go to Namecheap -> Domain List -> Manage -> Advanced DNS.

### A) If app runs on DigitalOcean Droplet

| Type | Host | Value | TTL |
|---|---|---|---|
| A | @ | `YOUR_DROPLET_PUBLIC_IP` | Automatic |
| A | www | `YOUR_DROPLET_PUBLIC_IP` | Automatic |
| A (optional company subdomain) | company1 | `YOUR_DROPLET_PUBLIC_IP` | Automatic |
| A (optional company subdomain) | company2 | `YOUR_DROPLET_PUBLIC_IP` | Automatic |

### B) If app runs on DigitalOcean App Platform

Use the exact records shown in App Platform domain settings. Commonly:

| Type | Host | Value | TTL |
|---|---|---|---|
| A / ALIAS | @ | `app platform target` | Automatic |
| CNAME | www | `app platform target` | Automatic |
| CNAME (optional company subdomain) | company1 | `app platform target` | Automatic |
| CNAME (optional company subdomain) | company2 | `app platform target` | Automatic |

## 3) Optional Multi-Company Subdomain Mapping

If you want URL-based company selection:

1. Add DNS records for each company subdomain (example `company1.yourdomain.com`).
2. In app `Company Profile`, set each `subdomain` value (example `company1`).
3. Ensure `NEXTAUTH_URL` points to your primary login URL.

## 4) Deployment Steps (Quick)

```bash
npm ci
npm run db:generate
npm run db:push
npm run build
```

Then start app process and verify:

```bash
bash scripts/postdeploy-check.sh https://payroll.yourdomain.com
```

## 5) Troubleshooting

- `P1001` cannot reach DB:
  - Check DB host/port/password and DB trusted sources.
- `NEXTAUTH_URL` mismatch:
  - Set exact public URL and redeploy/restart.
- HTTPS not ready:
  - Wait for DNS propagation and SSL issuance.
