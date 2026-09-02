# Monitors Delivery Acceptance Scenarios

Official DSH reference: `dd6322d604e00eec1ba5e0c8541159906a21094a`

| ID | Scenario | Required result | Evidence |
| --- | --- | --- | --- |
| MON-001 | Monitors-only boot | Packed plugin installs without Events and parks without failing DSH startup. | official DSH |
| MON-002 | Late Events activation | Events appearing later receives exactly one Monitor provider registration. | Cordis contract |
| MON-003 | Durable timer | `relay_schedule_timer` commits one Wait/Monitor and later delivers `timer.elapsed` to its owner. | integration |
| MON-004 | Overdue restart | An overdue timer fires after Host restart without a live original Agent turn. | integration |
| MON-005 | Positive delay validation | Zero, negative, fractional, overflow, and empty prompts fail before persistence. | unit |
| MON-006 | Field transition | Trusted provider baseline plus transition emits one configured Event. | unit |
| MON-007 | Unseen item | A recurring trusted provider emits only the first unseen identity and pauses. | unit |
| MON-008 | Rearm | Explicit rearm binds the recurring Monitor to a replacement Wait without replaying the old trigger. | integration |
| MON-009 | Duplicate trigger | Repeated identical observations create no duplicate Event or Delivery. | integration |
| MON-010 | Observer failure | Failures record checks, degrade, then emit one `monitor.failed` without claiming the business Wait. | integration |
| MON-011 | Missing observer | Unknown observer rejects baseline and preserves the previous Wait set. | contract |
| MON-012 | Duplicate observer | Duplicate provider registration fails without replacing the active provider. | registry unit |
| MON-013 | Lease exclusion | Concurrent checks execute one observation and return busy for the loser. | integration |
| MON-014 | Run-now | Events management run-now delegates to Monitors and refreshes durable state. | service contract |
| MON-015 | Clean unload | Timer loop, observers, Agent tools, Event provider registration, and in-flight work are released safely. | lifecycle |
| MON-016 | Generated-code rejection | Artifact kinds requesting generated JS, shell, browser, or unrestricted network are rejected. | security unit |
| MON-017 | Package boundary | Tarball imports only public Events contracts, contains no Relay parent source, and installs cleanly. | pack/static |
| MON-018 | Events composition | Events+Monitors packed tarballs boot and the timer path works on official DSH. | official DSH |
| MON-019 | Absolute deadline | Explicit-zone RFC3339 input preserves original intent, stores one UTC deadline, and rejects timezone-less, invalid, past, or mixed relative/absolute input. | unit + integration |
| MON-020 | Snapshot change | A stable fingerprint produces no Event; one new fingerprint emits one deterministic bound Event. | detector + composition |
| MON-021 | Observation boundary | Exact byte/depth/node limits pass; one-over, cycles, and non-JSON values fail before detector/commit with stable redacted errors. | controller unit + composition |
| MON-022 | Proposal budgets | Cadence, jitter, threshold ordering, and backoff boundaries reject atomically at persistence as well as proposal validation. | SQLite fault matrix |
| MON-023 | Management lifecycle UI | Pause, resume, run-now, cadence, stop, stale versions, terminal history, and keyboard confirmation remain inspectable in English and Chinese. | official DSH browser + service contract |

## Monitor Bundle Registry Increment

These rows qualify discovery and plugin-type instantiation. The following custom and
provider rows qualify Agent-authored execution.

| ID | Scenario | Required result | Evidence |
| --- | --- | --- | --- |
| MB01-001 | Empty Core catalog | Core returns an empty creation catalog before extensions register. | registry unit |
| MB01-002 | Localized registration | A complete type is visible immediately in English and Chinese through the public service and Agent tool. | registry + tool contract |
| MB01-003 | Deterministic listing | Multiple types and versions have deterministic order and deeply frozen projections. | registry unit |
| MB01-004 | Duplicate identity | A duplicate type/version fails without replacing the first registration. | registry unit |
| MB01-005 | Invalid definition matrix | Invalid API, ID, version, Events, schema, capability, lifecycle, locale, and factory fail before visibility. | table-driven unit |
| MB01-006 | Owner-safe disposal | Disposal is idempotent and a stale disposer cannot remove a replacement. | lifecycle unit |
| MB01-007 | Concurrent unload | New lists reflect unload immediately; an in-flight list remains one complete snapshot. | lifecycle unit |
| MB01-008 | Authorization filtering | A denied caller sees no entry or hidden metadata. | security unit |
| MB01-009 | Configuration state | Four supported states survive; invalid or throwing health checks fail closed as unavailable. | health unit |
| MB01-010 | Secret-safe projection | Executable hooks, unknown origin fields, credential values, and secret handles are absent. | seeded-secret scan |
| MB08-001 | Session-bound list tool | Tool accepts no Session or credential input and derives ownership from the root Agent installation context. | DSH tool compiler contract |
| MB02-001 | Valid plugin instance | Available type validates, baselines, and atomically commits Wait and Monitor. | registry + Cordis + SQLite |
| MB02-002 | Session derivation | Tool and factory cannot select another Session owner. | security unit + Cordis |
| MB02-003 | Typed parameters | String/Unicode/integer/boolean/enum/array/object and exact boundary failures execute the declared schema. | table-driven unit |
| MB02-004 | Declaration narrowing | Factory cannot add Event, capability, or lifecycle outside its registered type. | security unit |
| MB02-005 | Factory boundary | Throw, timeout, invalid graph, true cycle, and shared-reference cases are explicit before persistence. | fault unit |
| MB02-006 | Baseline atomicity | Registry success is not tool success; Events baseline/commit must complete first. | Cordis + SQLite |
| MB08-002 | Create-from-type tool | Tool has no Session input and returns exact durable IDs/next check after commit. | DSH tool compiler + SQLite |

## Custom Bundle And Capability Provider Increment

| ID | Scenario | Required result | Evidence |
| --- | --- | --- | --- |
| MB03-001 | Immutable validation | Source/manifest/owner produce a persistent expiring receipt and content-addressed artifact; tampering fails on read. | QuickJS + filesystem |
| MB03-002 | Project boundary | Canonical root/descendant reuse succeeds; sibling, parent, prefix collision, and symlink escape fail. | real filesystem |
| MB03-003 | Invalid manifest | Expiry, locale, Event, grant, schedule, schema, and module faults install nothing. | table unit |
| MB03-006 | Event boundary | Baseline emits nothing; one transition emits one declared schema-valid stable-key Event; multiple Events fail. | QuickJS + broker |
| MB03-009 | Update/rollback | Update commits a new immutable version, baseline failure preserves the old one, rollback reuses history and cannot expand grants. | Cordis + SQLite |
| MB03-010 | Expiry cleanup | Expiry terminalizes without Event; unreferenced receipts/source are removed without deleting shared/live content. | fake clock + restart |
| MB04-001 | Sandbox isolation | Environment, filesystem, network, process, modules, timers, clock, randomness, WASM, and native authority are absent. | QuickJS WASM |
| MB04-005 | Sandbox budgets | CPU, memory, stack, depth, node, and output one-over cases return stable redacted failures. | real sandbox |
| MB04-008 | Provider contract | Duplicate/API/schema/mutate/authorization/output errors fail closed and exact grants succeed. | registry + broker |
| MB04-009 | Provider lifecycle | Unload rejects late results and degrades affected Monitors; compatible reload recovers without Wait replacement or replay. | Cordis lifecycle |
| MB05-007 | Time legacy migration | `clock`/`deadline_reached` persisted data retains ID, deadline, Event key, Wait, and continuation under the Time extension. | SQLite + extension alias |
| MB06-008 | GitHub legacy migration | `github`/`snapshot_changed` persisted data retains stable subject, baseline, correlation, Wait, and continuation. | SQLite + extension alias |
