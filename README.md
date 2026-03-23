# LeadFlow Pro

Production-ready SaaS for lead generation, campaign outreach, email automation, and billing.

## Stack

- Frontend: React + Vite + Tailwind CSS + Framer Motion
- Backend: Express (Node.js)
- Database: PostgreSQL + Prisma
- Scraping: Playwright
- Email: Nodemailer (SMTP)
- Billing: Mollie API

## Local Setup

1. Install dependencies:
`npm install`

2. Copy env template:
`cp .env.example .env`

3. Configure required values in `.env`:
- `DATABASE_URL`
- `JWT_SECRET`
- `MOLLIE_API_KEY`
- `MOLLIE_WEBHOOK_URL`
- `VITE_API_URL`

4. Generate Prisma client and migrate:
`npx prisma generate && npx prisma migrate dev`

5. Seed demo/admin users:
`node prisma/seed.js`

6. Encrypt legacy stored secrets (one-time, after setting `ENCRYPTION_KEY`):
`node backend/src/scripts/encryptSecrets.js`

7. Run backend (port 8080 default):
`node backend/server.js`

8. Run queue worker (separate process):
`node backend/worker.js`

9. Run frontend:
`npm run dev`

## Deployment

Package boundary decision: deploy as a single root Node service and start the API with `node backend/server.js`.

### Backend (Render)

- Use `render.yaml` from repo root.
- Build command installs Prisma client and Playwright Chromium.
- Start command runs migrations before boot: `npx prisma migrate deploy && node backend/server.js`.
- Health check: `/health`
- Set env vars from `.env.example`.
- Set `FRONTEND_URL` to the exact deployed frontend URL for strict CORS.

### Backend (Railway)

- `railway.toml` included.
- Build command installs Prisma client and Playwright Chromium.
- Start command runs migrations before boot: `npx prisma migrate deploy && node backend/server.js`.
- Set env vars from `.env.example`.
- Set `FRONTEND_URL` to the exact deployed frontend URL for strict CORS.

### Worker (Railway)

- Create a second Railway service from the same repo.
- Use `railway.worker.toml` values for that service.
- Start command for worker: `npx prisma migrate deploy && node backend/worker.js`.
- Use the same `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY`, and SMTP env vars as the API service.

### Frontend

- Set `VITE_API_URL` to deployed backend URL.
- Example: `VITE_API_URL=https://leadflow-pro-api.onrender.com`

## Health Check

- Backend endpoint: `GET /health`
- Frontend login performs health check before enabling auth actions.

## Notes

- The app always renders UI (no blank screen state).
- If backend is unavailable, frontend shows `Backend not connected` and retry controls.
- Login supports 2FA challenge flow with TOTP or recovery code fallback.
- New frontend modules: Inbox Sync, CRM Integrations, Analytics, Security/2FA, Campaign Builder.
- Admin includes queue worker health (`/api/admin/worker-health`) based on worker heartbeat logs.
- Dunning includes staged retry visibility (`grace`, `warning`, `suspended`) via `/api/billing/dunning-events`.

## E2E Smoke Test Runbook

1. Signup new user.
2. Login (if 2FA enabled, complete challenge).
3. Scrape leads from `Leads` page.
4. Create campaign and launch send from `Campaigns`.
5. Open tracking pixel endpoint via one sent email and verify open event.
6. Mark/ingest reply via campaign logs or Inbox sync.
7. Upgrade plan in `Billing` and complete Mollie checkout.
8. Trigger webhook and confirm subscription switches to `active`.
9. Validate admin metrics and worker health in `Admin` page.
10. Simulate failed payment with `/api/billing/dunning/simulate-failure/:subscriptionId`, process retries with `/api/billing/dunning/process`, and verify stage progression.