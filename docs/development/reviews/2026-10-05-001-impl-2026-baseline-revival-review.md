# Review: atp-live-proxy 2026 Baseline Revival (Phases 1-2)

**Review type:** commits `da6544b` (phase 1), `beb1654` (phase 2) on `origin/main` `7b1821e`; plan `docs/development/plans/001-impl-2026-baseline-revival.md`
**Scope:** Dependency bumps (axios, socket.io, express, redis, node-cron, json-diff-ts, morgan, compression, cors, swagger-jsdoc, commander, nodemon), ESLint 8 → 9 flat config, CI workflow changes, Node 22 alignment, freeze-mode health surfacing, env.example coverage guard test, log-retention default change, audit exception, plan and evidence accuracy.
**Reviewer:** Staff engineer
**Local verification:** Node v22.23.2 / npm 10.9.8, in the worktree:
- `npm ci`: OK
- `npm run lint`: exit 0
- `npm test`: 8 suites, 81 passed / 3 skipped
- `npm audit --omit=dev --audit-level=high`: exit 0, "found 0 vulnerabilities"
- `npm audit` (full tree): 30 high, 0 critical/moderate/low, all from the single advisory `braces` GHSA-vfj7-8cjw-p6xm; `npm view braces version` = 3.0.3 (latest)
- `npx npm@11.6.0 ci --only=production` on a copy of the lockfile: 146 packages, 0 of jest/eslint/nodemon/supertest/braces; `npm audit --omit=dev`: 0
- End-to-end smoke (`NODE_ENV=production`, throwaway `redis:7-alpine`, fake ATP upstream, fake maple webhook receiver): `/health` 200; `/api/health` `healthy`, `freezeMode:false`, `provider:redis`; `/api/info` 200; proxied `/api/live-matches` and `/api/schedules` 200 with `Authorization: Bearer <token>` reaching upstream; keys written to Redis; Socket.IO EIO4 polling handshake OK; background poller detected a new match, and the webhook client delivered a signed `match_started` event (HTTP 200); SIGTERM gave a clean Redis close and "Server closed"; no deprecation warnings in the log
- json-diff-ts 4.8.2 vs 4.10.4 differential fuzz (20,000 random live-matches/draws/no-options pairs using the exact `embeddedObjKeys` configurations from `eventGenerator.getDiffOptions`): 0 mismatches in the "changeset non-empty" gate, 0 throws in either version
- ESLint 8.57.1 + the original `.eslintrc.js` against current `src/`: exit 0 (no masked regressions). Rule-set diff 8 → 9 shown under P2.
- GitHub Actions: "Test Suite" run 37335008018 on `beb1654` (22.x) succeeded

## Summary

The revival is careful and well-scoped. All updates stay within the current major version. The production dependency tree is clean. The single audit exception is real, has no upstream fix and only affects dev tooling. The CI and Node 22 alignment is correct. Every gate claim in the plan that I could reproduce held. The dependency bumps carry no behavioral regressions on the code paths this service uses:
- **axios:** `create`/`get`/`post` with `baseURL` + relative path, and per-request agents.
- **redis:** `createClient`/`get`/`setEx`/`ttl`/`del`/`flushDb`/`info`.
- **json-diff-ts:** `diff` is used only as an "anything changed?" gate.
- **node-cron, socket.io `Server`, morgan/compression/cors:** default usage.

Flipping `/api/health` `status` to `"warning"` breaks nothing:
- Docker `HEALTHCHECK` uses `curl -f`, so only the HTTP status matters, and that is always 200.
- Railway has no `healthcheckPath` and ignores Docker `HEALTHCHECK`.
- Neither walnut (`src/`) nor maple consumes the proxy's `/api/health`.
- The bundled `public/test-deployment.html` only displays the JSON.

The main gap is in the freeze-mode surfacing, which covers only one of the three freeze variables. If `WEBSOCKET_ENABLED=false` is left over from Nov 2025, the background poller never starts. No events are generated and nothing reaches maple, yet `/api/health` reports `healthy` and `freezeMode:false`. The plan's own ops verification step would therefore pass on a deployment that sends no push events. This is a P1 because the plan names exactly this failure mode as the risk it mitigates.

**Readiness:** Ready with corrections — no blockers; fix P1.1 (surface the realtime/events kill-switches in `/api/health` and the ops check) before the Railway 2026 deploy.

## Strengths

- **Disciplined dependency policy:** all updates stay in-range, `npm audit fix` is never run with `--force`, and framework majors are explicitly deferred with a "Not In Scope" list. Lockfile changes match `package.json` exactly. `validator` (the source of a prod advisory) dropped out through swagger-jsdoc 6.3.0.
- **The audit exception is honest and verifiable:** it is a single advisory with no patched release, reached only via `jest`/`nodemon`, and absent from the production image. I confirmed this with npm 11.6.0, the version the Dockerfile pins.
- **ESLint 9 migration notes are accurate:**
  - `sourceType: 'commonjs'` fixes a latent misconfiguration.
  - `caughtErrors: 'none'` preserves the ESLint 8 behavior.
  - Jest globals are now scoped to test files, which is a real improvement because the old config allowed `describe`/`expect` in production code.
- **The freeze-mode warning is additive and non-breaking:** it appears both at startup (`src/server.js:181-183`) and in `/api/health` (`src/routes/api.js:634-643`), with `cache.provider` exposed. Tests cover both the on and off paths via a `getProviderType` spy instead of real filesystem state.
- **The env.example guard is deterministic:** it is a pure static scan with no timing or network dependency, so it is not flaky. Every `process.env` access in `src/` uses dot notation (no bracket or destructuring access exists), so the regex sees them all. I confirmed it fails when a documented variable is removed.
- **The retention change removes a real config/runtime divergence:** before, config said 7 days but runtime used 30. The effective default is unchanged and invalid values now fall back to 30 instead of producing `NaN` (see P2 for the `0` edge case).
- **The plan is a good operational artifact:** it records before/after audit numbers, the hardcode sweep results, and an explicit owner-only ops checklist. It reads no secrets.

## Production Readiness Blockers

None.

## High Priority (P1)

### P1.1 — Health surfacing covers `FILESYSTEM_CACHE_DIR` but not the other two freeze kill-switches; `WEBSOCKET_ENABLED=false` silently stops all events to maple

**Files:** `src/routes/api.js:634-643`, `src/server.js:200-204`, `src/websocket.js:30`, `src/services/pollingService.js:76-80`, plan ops checklist item 2.

`pollingService.start()` is called only from `webSocketServer.initialize()`. With `WEBSOCKET_ENABLED=false`, which is part of the documented Nov 2025 freeze recipe:
- No endpoint is ever polled in the background.
- `eventGenerator.processData` is never called.
- The webhook client never posts to maple, so there are no match/score push notifications.

The same happens with `EVENTS_ENABLED=false` (`pollingService.js:77`). In both cases, HTTP proxying through `/api/*` still works, so walnut looks fine. Meanwhile `/api/health` returns `status: healthy` and `freezeMode: false`. The ops step "verify that `/api/health` reports `freezeMode: false` after deploy" passes even though the realtime pipeline is dead. An unset `EVENTS_WEBHOOK_URL` is also invisible from health.

**Fix:**
1. In `/api/health`, add something like `realtime: { websocket: config.websocket.enabled, events: config.events.enabled, webhookConfigured: !!config.events.webhookUrl }`.
2. Push a warning and downgrade `healthy` → `warning` when any of them is off. In production, consider treating a missing webhook URL as a warning too.
3. Log a matching startup `console.warn` next to the FREEZE MODE warning.
4. Extend `readiness.test.js` with a case for each flag. `config` is a live object, so it can be toggled or spied the same way as `getProviderType`.
5. Change ops checklist item 2 to verify `freezeMode: false` **and** `realtime.websocket/events/webhookConfigured: true` and no warnings.

Optionally, `freezeMode` could be defined as `filesystem || !websocket || !events`. Keeping them separate is clearer.

## Medium Priority (P2)

- **P2.1 — "Rule parity" claim is slightly overstated** (`eslint.config.js:10`, plan Phase 1 notes).
  - The custom rules are identical, but `eslint:recommended` changed between 8 and 9. Effective rules lost: `no-extra-semi`, `no-mixed-spaces-and-tabs`, `no-inner-declarations` (`no-new-symbol` became `no-new-native-nonconstructor`). Gained: `no-constant-binary-expression`, `no-empty-static-block`, `no-unused-private-class-members`.
  - `ecmaVersion` also went from 12 (2021) to 2022, and ESLint 9 now reports unused disable directives as warnings by default.
  - None of this hides a problem today (ESLint 8 with the old config also passes on current `src/`).
  - Fix: add one line to the plan's migration notes. Optionally re-enable `no-extra-semi` / `no-mixed-spaces-and-tabs` for strict parity.
- **P2.2 — Coverage upload in CI is dead** (`.github/workflows/test.yml:36,46-54`).
  - `npm test` is `jest` without `--coverage`, so `coverage/lcov.info` never exists. The codecov upload then fails anyway with "Token required - not valid tokenless upload" (seen in run 37335008018). `fail_ci_if_error: false` hides both problems.
  - This was already broken before; the PR only re-pointed the `if:` to `22.x`, which is now always true and therefore redundant.
  - Fix: either run `npx jest --coverage` in that job and set `CODECOV_TOKEN`, or delete the step and its `if:`.
- **P2.3 — env guard regex can span lines** (`src/tests/readiness.test.js:137`).
  - In `^#?\s*([A-Z]...)=`, `\s*` matches newlines, so a bare `#` line followed by a variable on the next line counts as documented. That is harmless today because no match spans a newline.
  - Fix: tighten to `/^#?[ \t]*([A-Z][A-Z0-9_]+)=/gm`.
  - Also consider widening the source regex to catch `process.env['X']` in case bracket access is ever introduced.
- **P2.4 — Readiness health tests depend on the developer's `.env`** (`src/tests/readiness.test.js:8-10`).
  - `require('../server')` loads `src/config`, which calls `dotenv.config()` against the real `.env`. If a developer `.env` contains `FILESYSTEM_CACHE_DIR` or `CACHE_ENABLED=false` (plausible for whoever ran the 2025 freeze), the test "`/api/health` ... freezeMode=false by default / provider memory" fails locally.
  - CI is unaffected because it has no `.env`. Other suites follow the same pattern.
  - Fix: add `process.env.FILESYSTEM_CACHE_DIR = ''` next to the existing `REDIS_URL = ''` / `CACHE_ENABLED = 'true'` lines, before requiring the server. dotenv does not override variables that are already defined, so this keeps a local `.env` from changing the result.
- **P2.5 — `LOG_RETENTION_DAYS=0` semantics changed** (`src/config/index.js:78`).
  - Old `server.js` code: `'0'` → `parseInt` → `0`, meaning "keep only today". New: `parseInt('0') || 30` → 30.
  - This is an unlikely setting, and API logging is off by default (`ENABLE_API_LOGGING=false`), but the plan says "effective behavior is unchanged".
  - Fix: either document that the minimum is 1, or use `Number.isFinite(n) && n >= 0 ? n : 30`.
- **P2.6 — Railway deploys are not health-gated** (`railway.toml`, `Dockerfile.production:34-35`).
  - Railway ignores Docker `HEALTHCHECK`, and `railway.toml` sets no `healthcheckPath`, so a deploy that crashes after boot (for example, Redis unreachable → `process.exit(1)`) still swaps traffic.
  - Separately, Docker `HEALTHCHECK` targets `/api/health`, which sits behind the `/api` rate limiter and always returns 200.
  - Fix: add `[deploy] healthcheckPath = "/health"` to `railway.toml` and point the Docker `HEALTHCHECK` at `/health`. This is a cheap way to catch a bad tournament-week deploy.
- **P2.7 — Dead node-cron option** (`src/server.js:226`, pre-existing): node-cron 4.x removed `scheduled` (tasks start on `schedule()`). It is harmless; drop it when next touching the file.
- **P2.8 — Swagger `HealthResponse.status` doesn't document its values** (`src/swagger.js:71-74`). Add `enum: [healthy, warning, critical]` now that `warning` has a second trigger.

## Readiness Checklist

**P0 blockers**
- [x] None

**P1 recommended**
- [ ] P1.1 — `/api/health` (and the startup log) surfaces `WEBSOCKET_ENABLED`, `EVENTS_ENABLED`, and whether the webhook URL is configured; tests added; ops checklist item 2 updated to verify them

**P2 (post-fix or post-tournament)**
- [ ] P2.1 Plan note on the recommended-set drift (optionally restore `no-extra-semi` / `no-mixed-spaces-and-tabs`)
- [ ] P2.2 Fix or remove the codecov step
- [ ] P2.3 Tighten the env.example regex
- [ ] P2.4 Pin `FILESYSTEM_CACHE_DIR=''` in `readiness.test.js`
- [ ] P2.5 `LOG_RETENTION_DAYS=0` handling or documentation
- [ ] P2.6 `railway.toml` `healthcheckPath = "/health"`; Docker `HEALTHCHECK` → `/health`
- [ ] P2.7 Drop `scheduled: true`
- [ ] P2.8 Swagger status enum

**Ops (owner, unchanged from plan)**
- [ ] 2026 `ATP_BEARER_TOKEN` in Railway
- [ ] Freeze cleared in Railway (all three variables, verified through the extended health output from P1.1)
- [ ] `ALLOWED_ORIGINS`, `EVENTS_WEBHOOK_URL`, `EVENTS_WEBHOOK_SECRET` match the 2026 maple/walnut deployments
