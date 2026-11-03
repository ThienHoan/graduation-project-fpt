# CI/CD

This repository uses GitHub Actions for CI.

Workflow file:

```text
.github/workflows/ci.yml
```

The repository is a pnpm workspace:

```text
pnpm-workspace.yaml
frontend/
backend/
```

Use one root lockfile:

```text
pnpm-lock.yaml
```

Do not commit `package-lock.json` or nested pnpm lockfiles.

## What CI Runs

On pull requests and pushes to `main` or `develop`, CI runs two jobs.

Frontend job:

```bash
pnpm install --frozen-lockfile
pnpm --dir frontend lint
pnpm --dir frontend typecheck
pnpm --dir frontend test
pnpm --dir frontend build
```

Backend job:

```bash
pnpm install --frozen-lockfile
pnpm --dir backend prisma:generate
pnpm --dir backend lint
pnpm --dir backend typecheck
pnpm --dir backend test
pnpm --dir backend build
```

Backend CI uses a dummy `DATABASE_URL` only for Prisma client generation. It does not connect to Supabase.

## Local CI Commands

From the repository root:

```bash
pnpm ci:frontend
pnpm ci:backend
pnpm test
```

Or run per app:

```bash
pnpm --dir frontend lint
pnpm --dir frontend typecheck
pnpm --dir frontend test
pnpm --dir frontend build

pnpm --dir backend prisma:generate
pnpm --dir backend lint
pnpm --dir backend typecheck
pnpm --dir backend test
pnpm --dir backend build
```

## Deployment Plan

Deployment is not enabled yet because deploy providers and tokens are not configured.

Recommended MVP deployment:

```text
Frontend: Vercel
Backend: Railway or Render
Database: Supabase PostgreSQL
```

Required secrets if deploying later:

Frontend/Vercel:

```text
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
NEXT_PUBLIC_API_URL
```

> **Socket.IO trên production (chống Mixed Content).** Trang production chạy
> HTTPS, nên KHÔNG được để `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_SOCKET_URL` trỏ
> thẳng IP backend bằng `http://` (vd `http://104.248.147.219:4000/api`) —
> Socket.IO sẽ mở `http://.../socket.io/...` và bị trình duyệt chặn Mixed
> Content. Đặt `NEXT_PUBLIC_API_URL=https://<domain>/backend-api` (hoặc bỏ hẳn)
> để socket đi same-origin qua rewrite `/socket.io/*` của `next.config.js`.
> `resolveSocketUrl` cũng tự lùi về URL tương đối nếu phát hiện `http://`
> khác loopback khi trang HTTPS.

Backend/Railway or Render:

```text
DATABASE_URL
JWT_SECRET
FRONTEND_URL
```

## Branch Rules

Recommended GitHub branch protection for `main`:

- Require pull request before merging.
- Require CI checks to pass.
- Require review from Tech Lead for schema/API/booking/payment/auth changes.
- Block force pushes.

## Notes

- Do not put real Supabase credentials in workflow files.
- Use GitHub repository secrets for deploy credentials.
- CI should validate code. Deployment should be added only after the team chooses a provider.