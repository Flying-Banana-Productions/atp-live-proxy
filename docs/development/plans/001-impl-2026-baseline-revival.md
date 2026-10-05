# 2026 Baseline Revival: Dependency Hygiene & Tournament Readiness

**Version:** 1.0
**Created:** October 5, 2026
**Status:** In Progress

## Overview

atp-live-proxy has been dormant since the Nov 2025 Knoxville Challenger and must be ready for the Nov 2026 tournament. It deploys to Railway via `Dockerfile.production` (`node:22-alpine`). The code is healthy (7 Jest suites green, lint green) but the baseline has drifted:

1. **Security / dependency drift.** `npm audit` reports 53 vulnerabilities (3 low, 6 moderate, 43 high, 1 critical) across socket.io-parser, ws, validator, qs, axios and friends; most are fixable in-range. ESLint 8.57 is EOL.
2. **Runtime metadata is stale.** `engines.node` is `>=16.0.0` and CI still tests Node 16/18/20 even though every deploy target (and maple/walnut) runs Node 22 LTS.
3. **Tournament-specific config may be stale.** The Nov 2025 "data freeze" work (PR #2, `feat-freeze-mode`) added freeze-mode / filesystem-cache settings; any 2025-specific values or a freeze left enabled would block 2026 live data.

## Design Decisions

**In-range updates only.** Every dependency update stays within its current major. Framework majors (Express 5, redis 6, helmet 8, express-rate-limit 8, jest 30, dotenv 17+/18) buy nothing weeks before a live tournament and are deferred post-tournament.

**`npm audit fix` without `--force`.** Production tree must be clean of high/critical. Dev-only findings that have no upstream fix are documented as exceptions rather than force-downgraded (e.g. `npm audit fix --force` proposes `nodemon@1.x`, a regression).

**Node 22 LTS everywhere.** `engines.node` → `>=22`, `.nvmrc` → `22`, CI matrices collapse to `22.x`, matching `Dockerfile.production` and the maple/walnut services.

**ESLint 9 flat config with rule parity.** Port `.eslintrc.js` to `eslint.config.js` (`@eslint/js` + `globals`) keeping the same rule set; scope Jest globals to test files only.

**ATP bearer token is ops, not code.** The 2026 token is owner-provided and tracked as an unchecked ops item; no attempt is made to obtain it and no real `.env` is read.

## Phase 1: Dependency & Security Hygiene

**Completion gate:** `npm audit --omit=dev --audit-level=high` exits 0; full-tree high/critical findings either fixed or documented as exceptions below; `npm run lint` green under ESLint 9 flat config with no `.eslintrc*` present; `npm test` green; `engines`, `.nvmrc` and CI aligned on Node 22.

- [x] `npm audit fix` (non-force)
- [x] In-range updates: axios 1.20, commander 14.0.3, compression 1.8.2, cors 2.8.6, express 4.22.3, json-diff-ts 4.10.4, morgan 1.12.1, node-cron 4.6, redis 5.12.1, socket.io 4.8.4, swagger-jsdoc 6.3.0, nodemon 3.1.14 (dev)
- [x] 0 high/critical in production tree; full-tree exceptions documented
- [x] `engines.node` → `">=22"`; add `.nvmrc` (`22`); README prerequisite updated
- [x] CI (`node.js.yml`, `test.yml`) on Node `22.x` only (drop EOL 16/18/20); codecov upload condition follows
- [x] ESLint 8 → 9: `eslint.config.js` with `@eslint/js` + `globals`; delete `.eslintrc.js`; lint green

**Gate evidence (2026-10-05, Node v22.23.2):**

- `npm audit` before: 53 (3 low, 6 moderate, 43 high, 1 critical); production tree 18 (2 low, 5 moderate, 10 high, 1 critical).
- `npm audit` after: production tree **0** (`npm audit --omit=dev --audit-level=high` exit 0); full tree 30 high, 0 critical, 0 moderate, 0 low.
- **Documented exception:** all 30 remaining full-tree findings are a single advisory, `braces` GHSA-vfj7-8cjw-p6xm (stack exhaustion on deeply nested brace patterns, range `<=3.0.3`). 3.0.3 is the latest published `braces`; there is no patched release. It is reached only via dev tooling (`jest@29` → `micromatch`, `nodemon` → `chokidar`) with project-controlled glob patterns, never in the production image (`npm ci --only=production` verified to install 0 dev packages under npm 11.6.0). npm's only "fix" is `nodemon@1.14.10` (a major downgrade), rejected.
- ESLint 9.39.5 + `@eslint/js` 9.39.5 + `globals` 17: `npm run lint` green. Migration notes: `sourceType` set to `commonjs` (old config claimed `module`, but the code is CommonJS); `no-unused-vars` pins `caughtErrors: 'none'` because ESLint 9 changed the default to `'all'` (4 unused `catch (error)` bindings would otherwise fail); Jest globals now scoped to `src/tests/**` / `*.test.js` instead of everywhere.
- `npm test`: 7 suites pass, 74 passed / 3 skipped (unchanged from baseline).

## Phase 2: 2026 Readiness Checks

**Completion gate:** No 2025-specific hardcodes in runtime config (or each one fixed/documented); freeze mode verified OFF by default and documented; `/health` and `/api/health` confirmed; every `process.env.*` the code reads is documented in `env.example`; bounded local server smoke passes (`/health`, `/api/info`); `npm test` and `npm run lint` green.

- [ ] Review `src/config` and services for 2025-specific tournament IDs, years, dates
- [ ] Freeze mode / filesystem cache (PR #2): confirm OFF by default so 2026 live data flows; document in `env.example` / README
- [ ] Confirm `/health` and `/api/health` endpoints exist and respond
- [ ] `env.example` documents every env var read via `process.env`
- [ ] Bounded server smoke: start locally (Redis disabled or throwaway `redis:7-alpine`), curl `/health` and `/api/info`, stop
- [ ] Tests added for any behavior change

### Ops checklist (owner-provided, no code)

- [ ] Obtain the 2026 ATP API bearer token (`ATP_BEARER_TOKEN`) from the tournament/ATP contact and set it in Railway
- [ ] Confirm the 2026 tournament ID / year values in Railway env match the 2026 event
- [ ] Confirm freeze mode is not enabled in the Railway environment for 2026

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
