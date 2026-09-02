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

## Review 6 — Time extension separation

- A cross-package boundary assertion was added before the refactor and failed on
  Core's timer import, deadline detector, and convenience tool as intended.
- Core now has no Time identifiers in host, controller, observer registry, detector,
  or Agent bridge. Provider-owned `detect()` executes through the production runtime;
  generic legacy providers retain only domain-neutral detector compatibility.
- The real Cordis hot-install test initially failed even though registry unit tests
  were green: Cordis wraps Service calls with a tracing proxy, and JavaScript private
  fields rejected the proxied receiver. Binding the public registry methods to the
  Service instance preserved private state and fixed actual extension use.
- Root composition now constructs Time through the extension's public provider and
  proposal factory, including SQLite restart, backward/forward clock, cancellation
  races, dedupe, and bound Session delivery. This prevents a green Core suite from
  falsely implying that separately packaged Time composition works.

## Review 7 — public plugin-type instantiation

- Instantiation and tool tests were written first and failed because neither public
  method existed. The typed boundary matrix proves invalid values never call the
  factory; authorization and live health are rechecked at creation time.
- Security mutations make a factory spoof another Session, undeclared Event,
  undeclared capability, and unsupported lifecycle. Each fails before the callback
  that can reach Events.
- A production Cordis+SQLite test calls `relay_create_monitor_from_type` against the
  live Time registration and inspects the stored Monitor owner. It reports success
  only after the real baseline and atomic Events commit.
- That integration first exposed a false cycle classification for a JSON-serializable
  shared reference. A paired test now accepts shared DAG nodes and rejects a real
  ancestor cycle, proving the correction did not disable cycle protection.
- Factory throw/timeout and DSH tool compilation run with zero skip/todo. Artifact
  content hashing, concurrent create convergence, plugin migration, and provider-loss
  recovery are qualified by the following increments.

## Review 8 — custom Bundle, sandbox, and provider authority

- QuickJS WASM tests execute actual untrusted source and prove the absence of host,
  environment, I/O, module, clock, random, timer, and nested-WASM authority. Infinite
  CPU, memory pressure, invalid exports, and oversized output fail with stable classes.
- Persistent receipt tests restart the custom manager, re-hash source at use time,
  reject another Session, and prove concurrent install retries invoke Events once.
- Real canonical project directories cover child reuse plus parent, sibling,
  prefix-collision, and symlink escape refusal. Catalog projections are seeded with
  grant arguments and prove they never expose handles or working directories.
- Provider tests cover exact argument subsets, authorization, duplicate ownership,
  mutate refusal, schema failure, timeout, cancellation, oversized output, unload,
  and rejection of a result arriving after disposal.

## Review 9 — immutable update, rollback, expiry, and UI

- A Cordis+SQLite lifecycle test uses the actual Agent tools to install, update,
  fail a replacement baseline, rollback, unload/reload the provider, and finally emit
  one Event into the same Session. The failed update leaves version, active version,
  and history count unchanged.
- Version identity initially used only the source SHA. Review found that the same
  module with different config would collide; version hashing now includes source,
  normalized manifest/config, authorization boundary, and replacement lineage.
- Expiry cleanup uses a real private filesystem. It deletes expired receipts, keeps
  source while a live/shared reference exists, and collects the orphan on a later
  pass. The Events expiry test separately proves terminal evidence remains and no
  Event is fabricated.
- Packed official DSH browser acceptance found three defects that static tests did
  not: a 3.68:1 dark-theme remediation color, ambiguous pagination selectors after
  adding the second pager, and English Bundle data surviving a Chinese locale switch.
  Each defect first failed the release gate; the restored run passed the entire
  English/Chinese, light/dark, pagination, keyboard, responsive, fault, redaction,
  console, and network-cleanliness matrix.

## Review 10 — migration, packaging, and final discovery

- Unit aliases alone were rejected as insufficient migration evidence. Root
  composition now stores legacy Time and GitHub Monitor shapes in a real SQLite file,
  closes the services, reopens that file, and proves exact Monitor/Wait/version,
  baseline, continuation, Session, and stable Event identity before delivery.
- The final Monitors command runs typecheck, discovers 50/50 tests with zero skip/todo,
  builds the production QuickJS-containing Host bundle, and inspects the dry-run npm
  archive. The root integration process discovers 467/467 tests, including real process restart and
  expiry flows.
- The first clean CI push failed before tests because the package-local lockfile did
  not contain QuickJS; a hoisted root installation had hidden the defect locally.
  Regenerating the child lockfile and running `npm ci --ignore-scripts` before
  `npm run verify` now proves the independently checked-out package is installable.
- The external root acceptance report records the final official-DSH package SHA-256;
  keeping it outside this tarball avoids a self-referential hash. No workspace source
  or private artifact is used by that browser run.
