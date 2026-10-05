# 2026 Baseline Revival: Dependency Hygiene & Tournament Readiness

**Version:** 1.1
**Created:** October 5, 2026
**Status:** Complete (ops items open)

## Overview

atp-live-proxy has been dormant since the Nov 2025 Knoxville Challenger and must be ready for the Nov 2026 tournament. It deploys to Railway via `Dockerfile.production` (`node:22-alpine`). The code is healthy (7 Jest suites green, lint green) but the baseline has drifted:

1. **Security / dependency drift.** `npm audit` reports 53 vulnerabilities (3 low, 6 moderate, 43 high, 1 critical) across socket.io-parser, ws, validator, qs, axios and friends; most are fixable in-range. ESLint 8.57 is EOL.
2. **Runtime metadata is stale.** `engines.node` is `>=16.0.0` and CI still tests Node 16/18/20 even though every deploy target (and maple/walnut) runs Node 22 LTS.
3. **Tournament-specific config may be stale.** The Nov 2025 "data freeze" work (PR #2, `feat-freeze-mode`) added freeze-mode / filesystem-cache settings; any 2025-specific values or a freeze left enabled would block 2026 live data.

## Design Decisions

**In-range updates only.** Every dependency update stays within its current major. Framework majors (Express 5, redis 6, helmet 8, express-rate-limit 8, jest 30, dotenv 17+/18) buy nothing weeks before a live tournament and are deferred post-tournament.

**`npm audit fix` without `--force`.** Production tree must be clean of high/critical. Dev-only findings that have no upstream fix are documented as exceptions rather than force-downgraded (e.g. `npm audit fix --force` proposes `nodemon@1.x`, a regression).

**Node 22 LTS everywhere.** `engines.node` → `>=22`, `.nvmrc` → `22`, CI matrices collapse to `22.x`, matching `Dockerfile.production` and the maple/walnut services.

**ESLint 9 flat config, near rule parity.** Port `.eslintrc.js` to `eslint.config.js` (`@eslint/js` + `globals`) keeping the same custom rules and re-adding the formatting rules ESLint 9 dropped from `recommended`; scope Jest globals to test files only. The remaining `recommended` drift is listed in the Phase 1 evidence.

**ATP bearer token is ops, not code.** The 2026 token is owner-provided and tracked as an unchecked ops item; no attempt is made to obtain it and no real `.env` is read.

## Phase 1: Dependency & Security Hygiene

**Completion gate:** `npm audit --omit=dev --audit-level=high` exits 0; full-tree high/critical findings either fixed or documented as exceptions below; `npm run lint` green under ESLint 9 flat config with no `.eslintrc*` present; `npm test` green; `engines`, `.nvmrc` and CI aligned on Node 22.

- [x] `npm audit fix` (non-force)
- [x] In-range updates: axios 1.20, commander 14.0.3, compression 1.8.2, cors 2.8.6, express 4.22.3, json-diff-ts 4.10.4, morgan 1.12.1, node-cron 4.6, redis 5.12.1, socket.io 4.8.4, swagger-jsdoc 6.3.0, nodemon 3.1.14 (dev)
- [x] 0 high/critical in production tree; full-tree exceptions documented
- [x] `engines.node` → `">=22"`; add `.nvmrc` (`22`); README prerequisite updated
- [x] CI (`node.js.yml`, `test.yml`) on Node `22.x` only (drop EOL 16/18/20); dead codecov upload step removed (review P2.2: tests never ran with `--coverage` and no `CODECOV_TOKEN` is configured)
- [x] ESLint 8 → 9: `eslint.config.js` with `@eslint/js` + `globals`; delete `.eslintrc.js`; lint green

**Gate evidence (2026-10-05, Node v22.23.2):**

- `npm audit` before: 53 (3 low, 6 moderate, 43 high, 1 critical); production tree 18 (2 low, 5 moderate, 10 high, 1 critical).
- `npm audit` after: production tree **0** (`npm audit --omit=dev --audit-level=high` exit 0); full tree 30 high, 0 critical, 0 moderate, 0 low.
- **Documented exception:** all 30 remaining full-tree findings are a single advisory, `braces` GHSA-vfj7-8cjw-p6xm (stack exhaustion on deeply nested brace patterns, range `<=3.0.3`). 3.0.3 is the latest published `braces`; there is no patched release. It is reached only via dev tooling (`jest@29` → `micromatch`, `nodemon` → `chokidar`) with project-controlled glob patterns, never in the production image (`npm ci --only=production` verified to install 0 dev packages under npm 11.6.0). npm's only "fix" is `nodemon@1.14.10` (a major downgrade), rejected.
- ESLint 9.39.5 + `@eslint/js` 9.39.5 + `globals` 17: `npm run lint` green. Migration notes: `sourceType` set to `commonjs` (old config claimed `module`, but the code is CommonJS); `no-unused-vars` pins `caughtErrors: 'none'` because ESLint 9 changed the default to `'all'` (4 unused `catch (error)` bindings would otherwise fail); Jest globals now scoped to `src/tests/**` / `*.test.js` instead of everywhere. **Recommended-set drift (8 → 9):** the custom rules are identical, but `eslint:recommended` changed. It dropped `no-extra-semi`, `no-mixed-spaces-and-tabs` (both re-added as explicit rules) and `no-inner-declarations` (not re-added: block-level function declarations are valid ES2015+). It renamed `no-new-symbol` to `no-new-native-nonconstructor`. It added `no-constant-binary-expression`, `no-empty-static-block` and `no-unused-private-class-members`. Also, `ecmaVersion` moved 12 (2021) → 2022, and ESLint 9 reports unused `eslint-disable` directives as warnings by default. ESLint 8 with the original `.eslintrc.js` also passes on current `src/` (verified in review), so the drift masks nothing.
- `npm test`: 7 suites pass, 74 passed / 3 skipped (unchanged from baseline).

## Phase 2: 2026 Readiness Checks

**Completion gate:** No 2025-specific hardcodes in runtime config (or each one fixed/documented); freeze mode verified OFF by default and documented; `/health` and `/api/health` confirmed; every `process.env.*` the code reads is documented in `env.example`; bounded local server smoke passes (`/health`, `/api/info`); `npm test` and `npm run lint` green.

- [x] Review `src/config` and services for 2025-specific tournament IDs, years, dates
- [x] Freeze mode / filesystem cache (PR #2): confirm OFF by default so 2026 live data flows; document in `env.example` / README
- [x] Confirm `/health` and `/api/health` endpoints exist and respond
- [x] `env.example` documents every env var read via `process.env`
- [x] Bounded server smoke: start locally (Redis disabled or throwaway `redis:7-alpine`), curl `/health` and `/api/info`, stop
- [x] Tests added for any behavior change

**Gate evidence (2026-10-05, Node v22.23.2):**

- **2025 hardcodes:** none in runtime code. There are no tournament IDs, years or dates in `src/config`; the tournament is selected entirely by the tournament-scoped `ATP_BEARER_TOKEN`. The only `2025` strings are a Swagger/400-response example date (`2025-10-19`) in `src/routes/api.js` and a path comment in `src/utils/outputFormatters.js`; left as-is (illustrative only).
- **Freeze mode (PR #2):** the write-once filesystem cache is selected only when `FILESYSTEM_CACHE_DIR` is set; it is unset by default, and `WEBSOCKET_ENABLED` / `EVENTS_ENABLED` default to `true`, so live data flows out of the box. Risk: the filesystem cache has infinite TTL, so if the Nov 2025 freeze variables are still set in Railway, a 2026 deploy would serve the first response it fetched, forever. Mitigations added: startup `FREEZE MODE ACTIVE` warning; `/api/health` now reports `freezeMode`, `cache.provider`, a warning, and downgrades `healthy` → `warning`; freeze mode documented in `env.example` and README.
- **Realtime pipeline (review P1.1):** the freeze recipe also sets `WEBSOCKET_ENABLED=false` (`pollingService.start()` is only called from the WebSocket server, so the background poller never runs) and `EVENTS_ENABLED=false`. Either one silently stops all events to maple while HTTP proxying still works. `src/utils/realtimeStatus.js` derives `{websocket, events, webhookConfigured, warnings}`, where `webhookConfigured` requires both `EVENTS_WEBHOOK_URL` and `EVENTS_WEBHOOK_SECRET`, matching `webhookClient.isEnabled`. A missing webhook is flagged only when events are on. `/api/health` exposes `realtime.*`, pushes the warnings and downgrades `healthy` → `warning`. Startup logs `REALTIME DEGRADED: ...` for each warning. The Swagger `HealthResponse` documents `realtime` and the `status` enum (`healthy | warning | critical`).
- **Health:** `/health` (liveness, before the rate limiter) and `/api/health` (rich status) both respond 200. Note: `/api/health` returns HTTP 200 even when `status` is `critical` (e.g. bearer token missing). Left unchanged. Deploy gating (review P2.6): `railway.toml` now has `[deploy] healthcheckPath = "/health"` with `healthcheckTimeout = 60`, so a deploy that crashes after boot no longer takes traffic. The `Dockerfile.production` `HEALTHCHECK` now targets `/health`, which is not behind the `/api` rate limiter.
- **env.example:** was missing `TRUST_PROXY`, `POLLING_BACKOFF_ENABLED`, `POLLING_BACKOFF_MULTIPLIER`, `POLLING_BACKOFF_MAX_MULTIPLIER`, `POLLING_BACKOFF_RESET_ON_SUCCESS`, `API_LOG_MIN_INTERVAL`; all added. A new test fails if `src/` reads an undocumented `process.env` variable, through dot or bracket access. The env.example matcher is anchored per line (`/^#?[ \t]*NAME=/gm`).
- **Retention default:** `LOG_RETENTION_DAYS` defaulted to 7 in `src/config` but 30 in `server.js` (the value actually used) and `env.example`; `server.js` now reads `config.apiLogging.retentionDays`, and the config default is 30. Review P2.5: an explicit `LOG_RETENTION_DAYS=0` (keep only today) is honoured as before. Unset values fall back to 30, as before. Non-numeric and negative values also fall back to 30; previously they produced `NaN` or a future cutoff. Documented in `env.example`.
- **node-cron 4 (review P2.7):** dropped the removed `scheduled: true` option. Under node-cron 4.6.0, `cron.schedule(expr, fn, { timezone: 'UTC' })` starts immediately; a 1-second test task fired twice in 2.3 s without the option.
- **Tests:** new `src/tests/readiness.test.js` (22 tests) covers:
  - freeze mode off by default, and the filesystem cache selected only when its dir is set
  - retention parsing (unset/0/14/abc/-3)
  - `getRealtimeStatus` combinations
  - `/health`
  - `/api/health` freeze reporting (on/off), plus each realtime switch (`WEBSOCKET_ENABLED=false`, `EVENTS_ENABLED=false`, missing webhook URL, missing webhook secret) producing a field, a warning and non-healthy status
  - env.example coverage

  The suite mocks `dotenv` and pins `FILESYSTEM_CACHE_DIR=''`, so a developer `.env` cannot change results (review P2.4). I verified this with a temporary `.env` setting `FILESYSTEM_CACHE_DIR`, `CACHE_ENABLED=false` and `WEBSOCKET_ENABLED=false`: 22/22 passed. `npm test`: 8 suites, 96 passed / 3 skipped; `npm run lint` green.
- **Smoke:** `NODE_ENV=production node src/server.js` with no bearer token and `ATP_API_BASE_URL=http://127.0.0.1:9` (so nothing reaches the network); (a) with a throwaway `redis:7-alpine` on :56379, (b) with the in-memory cache. Both: `/health` 200, `/api/info` 200, `/api/health` `{status: critical, freezeMode: false, provider: redis|memory, warnings: [ATP_BEARER_TOKEN is not configured]}`, and a clean SIGTERM shutdown. (c) With `FILESYSTEM_CACHE_DIR` set, the startup warning was logged and `/api/health` reported `freezeMode: true`. Realtime smoke after the review fixes, with a dummy token and an unreachable upstream:
  - (d) all switches on: `status: healthy`, `realtime` all `true`, no warnings.
  - (e) `WEBSOCKET_ENABLED=false EVENTS_ENABLED=false`: `status: warning`, both realtime warnings, and the two `REALTIME DEGRADED` startup lines.

### Ops checklist (owner-provided, no code)

- [ ] Obtain the 2026 ATP API bearer token (`ATP_BEARER_TOKEN`, tournament-scoped) from the tournament/ATP contact and set it in Railway; verify `/api/health` shows `authentication.configured: true` and no critical warnings
- [ ] Confirm the Nov 2025 freeze is cleared in Railway: `FILESYSTEM_CACHE_DIR` unset, `WEBSOCKET_ENABLED` and `EVENTS_ENABLED` not `false`, `EVENTS_WEBHOOK_URL` and `EVENTS_WEBHOOK_SECRET` set. After deploy, verify that `/api/health` reports `freezeMode: false`, `realtime: {websocket: true, events: true, webhookConfigured: true}` and an empty `warnings` array
- [ ] Confirm that the Railway deploy honours the `/health` healthcheck from `railway.toml`; the deploy log should show the healthcheck passing
- [ ] Confirm `ALLOWED_ORIGINS`, `EVENTS_WEBHOOK_URL` and `EVENTS_WEBHOOK_SECRET` in Railway match the 2026 maple/walnut deployments (maple rotated its webhook secrets for 2026)

## Not In Scope (post-tournament)

- Express 4 → 5
- redis (node-redis) 5 → 6
- helmet 7 → 8
- express-rate-limit 7 → 8
- jest 29 → 30 (and supertest 6 → 7)
- dotenv 16 → 17/18
- commander 14 → 15
- ESLint 9 → 10
- Linting `replay-events.js` / root scripts (not currently covered by `npm run lint`)

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-10-05 | Initial plan |
| 1.1 | 2026-10-05 | Addressed review `docs/development/reviews/2026-10-05-001-impl-2026-baseline-revival-review.md` (P1.1, P2.1–P2.8) |

### Post-review fix (2026-10-05) — health memory metric

Railway PR environment smoke (`atp-live-proxy-pr-3`) showed `/api/health` reporting `critical` with "93% memory" on an idle process (the 2026 environment showed 88%). The metric was `heapUsed / heapTotal`; V8 grows `heapTotal` lazily, so that ratio is always high and made `/api/health` permanently `critical`. It now measures `heapUsed` against `v8.getHeapStatistics().heap_size_limit` (`src/utils/heapUsage.js`, tests in `src/tests/heapUsage.test.js`). Thresholds (70% warning / 85% critical) unchanged. Lint clean; 9 suites, 99 passed / 3 skipped.
