# Coordinator prompt: Paystack + BobGo migration

You are the coordinator for the Paystack + BobGo migration in C:\Projects\projects\leipelo-shopnex.

Objective: implement phases P0 to P6 of docs/paystack-bobgo-migration.md, merge them to main, and
leave a working local stack that I can test. Do not tag a release. Do not start Phase 7.

## MODEL AND CONCURRENCY

Every agent runs `opencode/deepseek-v4.1-flash-free`. The model comes from the OpenCode config
(`~/.config/opencode/opencode.jsonc`). Never pass `--model` to `agent launch` or `worker-start`:
Orca rejects launch-time model selection for opencode2. No paid model.
This model is small and rate limited. Therefore:

- Run one worker at a time. Do not dispatch two workers together.
- Give each dispatch exactly one phase. Never merge two phases into one task.
- Keep each spec short and concrete: exact file paths, exact commands, exact acceptance test.
- A worker must run its acceptance command and quote the real output. No assumed passes.
- Expect retries. A worker that fails the same test twice stops and reports to you.
- If the model returns a truncated or malformed answer, re-dispatch the same task. Do not
  patch its output by guesswork.
- Keep your own context small: read only the doc sections and files you need for the next step.

## STEP 0 — PREPARE

1. Read docs/paystack-bobgo-migration.md completely. It is the source of truth.
2. Check `git status`. It must be clean. If docs/paystack-bobgo-migration.md is still untracked,
   commit it to main with message "docs: Paystack + BobGo migration plan". Worktrees branch from a
   commit, so the file must be in the commit. If any other file is modified, stop and tell me.
3. Run `orca status --json`. Then `orca orchestration run-create --objective "Paystack + BobGo
   migration P0-P6 (docs/paystack-bobgo-migration.md)" --json`. Keep that run id for the whole job.
4. Read `orca skills get orca-cli` once for the worktree syntax. Create one worktree per phase
   BEFORE dispatching its worker:
   `orca worktree create --name mig-p0 --branch mig/p0-foundation --base-branch main --json`
   Use the returned path as `--worktree` for `worker-start`. OpenCode model selection needs an
   existing worktree, so never start a worker on `--worktree new-child`.

## SCOPE

- P0 foundation, P1 Paystack client, P2 BobGo client, P3 payments wiring, P4 shipping wiring,
  P5 removal + deploy + CI, P6 verification.
- Phase 5 deletes: apps/stripe, apps/shippo, apps/cj-dropshipping, packages/cj-sdk, modules/ai.
- Keep the app protocol in modules/apps, packages/marketplace-sdk, and the fake-app e2e tests.
- No new npm dependencies. No new containers. No API-key environment variables. Keys are entered
  in the admin console and sealed with encryptSecret.
- Do not change the design decisions in section 4 without asking me.

## TASK GRAPH (create all tasks first, with these dependencies)

- P0 mig/p0-foundation — no dependency
- P1 mig/p1-paystack — needs P0
- P2 mig/p2-bobgo — needs P0
- P3 mig/p3-payments — needs P0, P1
- P4 mig/p4-shipping — needs P0, P2, P3 (router.ts and admin-api.gen.ts; rebase P4 on P3)
- P5 mig/p5-removal — needs P3, P4
- P6 mig/p6-verify — needs P0..P5

Dispatch ONE worker at a time, in order: P0, P1, P2, P3, P4, P5, P6. Never run two workers on
router.ts, schema/index.ts, or the compose files at the same time.

## TASK SPECS

Every spec must contain: Target, Change, Constraints, Ownership, Observable acceptance (the exact
test command and gate). Use section 8 of the doc for the detail and section 13 for ownership.
Do not tell a worker "see section X" without also writing the essentials into the spec, because a
fresh worktree agent has no context.

### P0 — modules/db only

New schema/integrations.ts (shop_integrations), edit schema/checkout.ts + schema/payments.ts +
schema/index.ts, new src/integrations.ts, package.json export, migration 0043 via pnpm db:generate,
tests/integrations.test.ts on pglite.

Accept: pnpm --filter @shopnex/db test and typecheck pass; one new migration file; SQL inspected
by hand (drop-not-null, partial unique index).

### P1 — modules/payments/src/paystack.ts + tests/paystack.test.ts + index export

Pure fetch client: isPaystackKey, verifyWebhookSignature (HMAC-SHA512 raw body), verifyKey
(GET /balance), initialize, verifyTransaction, refund. metadata is JSON.stringify'd. 10 s timeout.
No DB, no Hono, no new dependency. Mock globalThis.fetch.

Accept: pnpm --filter @shopnex/payments test and typecheck pass.

### P2 — modules/cart/src/bobgo.ts + tests/bobgo.test.ts + index export

Pure client: config type, base URL sandbox/production, verifyKey, quoteRates. ZA + ZAR guards.
total_price ZAR to cents. 4500 ms timeout. No DB, no Hono, no new dependency.

Accept: pnpm --filter @shopnex/cart test and typecheck pass.

### P3 — payments wiring

modules/payments/src/sessions.ts (start, refund, syncPending), methods.ts, new
paystack-settings.ts, tests, modules/api/src/app.ts webhook route, admin/payments.ts + router.ts,
apps/admin-ui paystack-card.tsx + settings/payments.tsx + payment-methods-card.tsx,
checkout/functions.ts, modules/cart/src/checkout.ts (gateway + offsite snapshot),
regenerate packages/app/src/admin-api.gen.ts.

Accept: pnpm typecheck, pnpm lint, pnpm --filter @shopnex/payments test pass; pglite test proves
webhook success resolves, wrong amount does not, replay does not; no secret in any response.

### P4 — shipping wiring

modules/cart/src/carrier-services.ts (provider branch + upsertBuiltin) + new bobgo-settings.ts +
tests, admin/carrier-services.ts + router.ts, apps/admin-ui bobgo-card.tsx +
settings/shipping.tsx + carrier-services-card.tsx, regenerate admin types.

Accept: pnpm typecheck, pnpm lint, pnpm --filter @shopnex/cart test pass; non-ZA quote returns []
with no HTTP call; a BobGo 500 leaves flat rates working.

### P5 — removal

Delete the three apps, packages/cj-sdk, modules/ai. Empty BUNDLED_APPS. Remove the AI router,
settings route, ai-card, ai-dialog, the three ai-generate files, the Generate buttons, the
aiProviders delete in modules/apps/src/apps.ts, scopes ai_capabilities, marketplace-sdk/src/ai.ts.
Keep the ai_* tables (no drop migration). Simplify deploy to db + shopnex only. Update CI
(ci.yaml, demo.yml, release.yaml, create-shopnex.yaml), env-vars.ts, .env.example, root
package.json, create-shopnex extras, tenancy RESERVED_SLUGS (stripe -> paystack, bobgo), README,
docs/architecture.md.

Accept: pnpm install --frozen-lockfile, pnpm lint, pnpm typecheck, pnpm build, pnpm test pass;
`docker compose -f deploy/docker-compose.dokploy.yml config` is valid; rg for STRIPE_|SHIPPO_|
CJ_DROPSHIPPING_|SHOPNEX_BUNDLED_APPS is clean outside docs history.

### P6 — verification (automated part only)

Run e2e + browser suites. Fix failures in the owning phase (dispatch a follow-up to that worker,
do not patch outside ownership). If a screenshot tool is available, capture: Settings->Payments
Paystack empty and connected, Settings->Shipping BobGo filled, checkout with BobGo rates.
Do not open a real payment page. Tick the section 9 checklist in the doc for every item that
passed. Leave everything untagged.

## COORDINATOR RULES

1. Before a phase starts, check that its dependencies are merged and green.
2. Each worker gets: its worktree path, its branch, its exclusive file list, and the acceptance
   command. Tell it to run the gate commands before it reports.
3. A worker that needs a file outside its ownership must stop and ask. You then decide the owner.
4. Merge order: P0, then P1 and P2, then P3, then rebase P4 and merge, then P5, then P6.
5. After every merge to main run: pnpm install --frozen-lockfile, pnpm lint, pnpm typecheck,
   pnpm build, and the changed package's tests. If a merge touches router.ts, schema/index.ts, or a
   compose file, run the full pnpm typecheck before you continue.
6. Do not resolve a semantic conflict by guessing. Re-run the owning worker.
7. Use ORCA properly: one Task per phase, and start every worker with
   `worker-start --spec "<spec>" --worktree <path> --agent opencode2 --json`.
   Then `check --wait --types worker_done,escalation,question`, process, ack, and release.
   Every worker and the coordinator run OpenCode on the config model. Never pass --model.
   If worker-start exits non-zero, do not relaunch; report failedStage and read the recovery guide.
8. Do not stop between phases to ask permission. Ask only on a STOP trigger below.

## STOP AND ASK ME WHEN

- A Paystack or BobGo API detail in the doc is wrong or a response does not match it.
- The same test fails after two fix attempts.
- A schema change is needed beyond section 6.
- A key, token, or webhook body would appear in a log, a response, or a screenshot.
- Two phases need the same file at the same time and ownership is unclear.

## FINAL HANDOVER (this is what I need to test)

1. main is checked out, clean, and every gate above passes.
2. Migrations are applied to the local database.
3. The local stack runs: `docker compose -f deploy/docker-compose.dokploy.yml up -d` starts exactly
   db and shopnex, or the pnpm dev server runs on http://localhost:3000.
4. A short report with:
   - phase, branch, merged commit, and gate result for P0..P6;
   - the exact URL to open and how to create the first shop;
   - where to paste the Paystack test key (Settings -> Payments) and the BobGo sandbox key plus
     collection address (Settings -> Shipping);
   - how to point the Paystack webhook at localhost (tunnel or public URL);
   - the unticked section 9 items, and anything P6 skipped;
   - known risks from section 11 that are still open.

Do not create a release tag. Do not start Phase 7.

Start now with Step 0 and P0.
