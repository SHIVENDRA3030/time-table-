# Enterprise Readiness — Implementation Status

Companion to `enterprise-readiness-plan.md` (v1.0). This records what is
**implemented and verified** (smoke: `backend/scripts/smoke-enterprise.js`,
16/16 green), what is **scaffolded**, and what stays **deferred** with the
reason. Verified against the live Neon database on 2026-11-19.

## Implemented (verified by smoke test)

| Plan item | Where | Notes |
| --- | --- | --- |
| F5 clash guarantee | `database/schema.sql` (pre-existing UNIQUE constraints) + tx | The doc's race claim was incorrect — plain UNIQUE on `(section_id\|faculty_id\|room_id, day, time_slot_id)` already guarantees atomicity; the service check is for friendly messages only. What WAS missing: multi-statement mutations. `decideRequest` now runs in one transaction with `FOR UPDATE` row locking; `clearDatabaseData` is transactional. Note: the doc's `tstzrange` DDL sketch does not fit this schema (entries are `day TEXT + time_slot_id`), so `btree_gist`-based exclusions were **not** added — the existing UNIQUEs are the guarantee. |
| F6 idempotency | `backend/middleware/idempotency.js`, `idempotency_keys` table | `Idempotency-Key` on mutations stores the first response (24h TTL) and replays it. Mobile sends keys on every mutation. Verified: replay returns the same id, no duplicate rows. |
| F7 audit hardening | `audit_log` migration + trigger + `auditService` | `ip`/`user_agent` columns added; `BEFORE UPDATE OR DELETE` trigger makes the table append-only at the DB level (role-independent). Decide/reject write audit rows inside the same transaction as the mutation. |
| F8 soft deletes | migration + controllers | `deleted_at` on programs/sections/subjects/faculty/rooms; DELETE endpoints soft-delete; list/lookup queries filter it (including the rbac faculty link). |
| F10 rate limits + headers + caps | `backend/middleware/security.js`, upload multer limits | helmet headers, per-IP global 600/15min, auth 30/15min, heavy (upload/AI/export) 15/15min, proxy 120/min. Local dev loopback exempt (per-IP budget would burn from Vite HMR + tests). Upload capped at 10 MB, JSON bodies 1 MB. |
| F2 mobile token lifecycle | `backend/services/tokenService.js`, `routes/authRoutes.js`, `mobile/src/services/auth.ts` | Backend verifies the Neon session server-side and issues HS256 access tokens (15 min, audience `timetable-api`) with **rotating refresh tokens** (30 days, single use). Reuse of a superseded token revokes the family — verified in smoke. `verifyAuth` accepts both token families. Cookie replay is retired for mobile; SecureStore holds only the refresh token + access token. |
| F12 request lifecycle | migration + `requestController` + worker | `pending → applied | rejected | cancelled | expired`; `expires_at` = created + 72h; faculty can cancel own pending requests (`POST /api/requests/:id/cancel`); the worker expires stale ones and emits outbox events. |
| F13 term scoping | `academic_terms` + `term_id` columns | Seeded "AY 2026-27 · Semester 1"; entries/workloads/requests default to the open term. Rollover UI deferred (below). |
| F4 async pipeline | `jobs` table, `jobService` worker, `importService`, `uploadController`, `exportController` | `POST /api/upload` stages (parse + validate, 202 + preview, no writes); `POST /api/imports/:id/commit` applies transactionally in the worker with per-row error capture. Exports are queued and downloaded from `GET /api/exports/:id/download`. Worker claims with `FOR UPDATE SKIP LOCKED` (multi-instance safe) and requeues stale `running` jobs after a crash. |
| F17 outbox | `outbox_events` + worker dispatcher | Request decisions/expiries emit events; transport is console today (SMTP/push need credentials), delivery is at-least-once from the queue. |
| F3 tenancy scaffold | `institutions` + `institution_id` everywhere + **RLS with FORCE** | Single default institution seeded; every core table (incl. the new `portal_access`, `students`) is RLS-gated on `current_setting('app.institution_id')` with fallback to the default tenant. Going multi-tenant = insert rows + pass the tenant id per request. |
| F9 contract | `/api/v1` mounts + `backend/openapi.yaml` | Same routers served under `/api` (compat) and `/api/v1` (versioned). OpenAPI 3.1 spec covers the core surface; generated SDKs are the follow-up. |
| F16 observability (minimal) | `middleware/security.js` requestLogging | Request ids (`X-Request-Id`) + JSON access logs. Metrics/SLO dashboards deferred. |
| F15 proxy hardening | `server.js` | Proxy forwards a header allowlist only; rate-limited; no credential logging. Host allowlist implicitly env-bound (`NEON_AUTH_BASE_URL`). |

Also fixed during this work: the parallel-development tables (`portal_access`,
`students`) existed in `schema.sql` but not in the live DB — `rbac.attachUser`
threw on every request and all data routes 403'd. Created via
`backend/scripts/migrate-portal-tables.js` with the tenancy scaffold.

## Deferred (with reasons)

| Item | Why deferred | Path to done |
| --- | --- | --- |
| MFA for admins (§7.1) | Neon Auth managed server does not expose MFA (plugin matrix) | MFA lands when Neon ships it, or self-managed Better Auth |
| F1 stateless LB deployment | Single-instance is correct for current scale; the queue + SKIP LOCKED claims make multi-instance safe when needed | 2+ instances behind a LB; no code change expected |
| F4 full worker separation | Worker runs in-process (Postgres queue); a separate process/Redis is infra, not code | Split `jobService` loop into its own process; swap queue driver |
| Push/email transports | No SMTP provider or Expo push credentials configured | Set `SMTP_URL` / Expo push keys; outbox already emits |
| F14 scoped permissions | `role_assignments` design depends on whether departments become a real axis | Phase 3 decision |
| Quarterly restore drills, pen-test, SLO dashboards | Operational, outside the codebase | §10 of the plan |

## Verification

- `node backend/scripts/smoke-enterprise.js` → **16 passed, 0 failed** (run twice)
- Migrations: `migrate-enterprise.js` (87 statements, 0 failures), `migrate-portal-tables.js` (14, 0 failures)
- Smoke accounts (allowlisted): `mobile.admin@ttstudio.dev` (admin), `mobile.test@ttstudio.dev` (faculty, CSE-A). Cleanup SQL is printed by `backend/scripts/mobile-smoke-*.js`.
