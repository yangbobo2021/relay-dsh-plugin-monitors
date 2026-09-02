# Monitors Test Review

## Review 1 — plugin boundary

- Verified Monitors receives only the `relayEvents` v1 high-level service and
  contains no Event persistence or backend implementation.
- Verified Observer registration, duplicate refusal, disposal, missing-provider
  failure, and generated-code/privileged-capability rejection before baseline.

## Review 2 — timer and detectors

- Added positive safe-integer and prompt validation for durable timers.
- Added deadline, field-transition, and unseen-item cases.
- The first detector review exposed that normal `id` was not selected as trigger
  identity; the implementation now accepts both `id` and `*_id`.
- Added shutdown coverage that waits for in-flight observation and rejects new work.

Atomic Wait/Monitor commit, real Event delivery, recurring rearm, lease exclusion,
failure escalation, and restart recovery run against Events in Relay's cross-plugin
delivery harness.

## Review 3 — durable identity and shutdown

- Real SQLite checks exposed lost Observer identity after baseline; Events now
  persists the manifest's Observer/artifact and hydrates both.
- Checks use unique worker identities and bounded observation (maximum 30 seconds).
  Unload aborts observers, releases leases without increasing failure counters, and
  removes timer tools from surviving root Agents. Unit and Cordis lifecycle tests pass.
- Added durable composition tests for baseline rollback, failure escalation,
  concurrent leases, recurring rearm and overdue restart.
- Corrected distribution instructions to install built tarballs.

## Review 4 — resource budgets and publishable management

- Exact 256 KiB/depth-32/node-10,000 observation boundaries, plus cyclic and
  non-serializable observations, exercise the production controller before detector
  or persistence. The one-over cases remain stable `observation_too_large` failures.
- Events storage independently enforces cadence, jitter, failure-threshold, and
  backoff budgets transactionally so a forged provider cannot bypass proposal
  validation. Monitors verification discovered 13/13 tests with zero skip/todo.
- The packed official DSH management run exercised keyboard pause/resume/stop,
  focus trap and return, overdue/current timestamps, terminal history, bilingual
  copy, and browser console/network cleanliness.

## Review 5 — Bundle Type registry and live catalog

- Wrote the registry and Agent-tool contract tests before the implementation. The
  first run failed because the module and list tool did not exist, proving discovery.
- The next run reached the official DSH tool compiler and failed because the catalog
  output item schema omitted an explicit `additionalProperties` policy. Correcting
  the real tool schema, rather than bypassing the compiler, made the contract pass.
- A seeded-secret mutation then demonstrated that cloning an extension's entire
  origin object leaked an unknown `credential` field. The public projection now
  copies only `kind`, `plugin_id`, and `plugin_version`; the test fails if broad
  origin cloning returns.
- Coverage includes empty Core, complete English/Chinese metadata, deterministic
  order, all four health states, invalid-health fail-closed behavior, invalid
  definitions, duplicate atomicity, stale/idempotent disposal, authorization hiding,
  immutable caller input, concurrent unload snapshots, and Session-bound Agent input.
- `npm run verify` must execute all discovered tests, type checks, the production
  tsdown bundle, and `npm pack --dry-run`. No skip or todo is accepted. This increment
  does not claim instantiation, UI, official-DSH hot-plugin, or sandbox acceptance;
  those remain explicit later release gates.
