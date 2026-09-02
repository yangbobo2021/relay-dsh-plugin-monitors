# Relay DSH Monitors Plugin Specification

Status: Monitor Core `0.3.0` development delivery specification

## Purpose

`relay-dsh-plugin-monitors` contributes extensible durable bound Monitor execution to
the `relayEvents` service. Version `0.3.0` is Monitor Core: it publishes Bundle Type
and trusted Observer/Detector registries, runs leased checks, and provides generic
deterministic transition detectors.

Time is provided only by the independently installable
`relay-dsh-plugin-monitor-time` extension. Core contains no clock provider, deadline
detector, timer proposal factory, `timer.elapsed` Event knowledge, or
`relay_schedule_timer` tool.

## Boundary

The plugin owns:

- Monitor proposal validation and baseline observation;
- trusted Observer/Detector provider registry;
- Bundle Type definition validation, registry lifecycle, authorization-filtered
  discovery, migration contract, and localized keyset-paginated catalog projection;
- Session/project-scoped custom Bundle validation, immutable artifact/receipt storage,
  QuickJS WASM execution, update/rollback, expiry, and safe garbage collection;
- versioned read-only Capability Provider registration, authorization, schema,
  timeout, cancellation, response limits, and provider-loss recovery;
- leased due-check scheduling and run-now;
- deterministic detectors, retry/degraded/failed lifecycle, one-shot completion,
  and explicit recurring rearm;
- the Session-bound `relay_list_monitor_bundle_types` Agent tool;
- registration/disposal of one Monitor provider with Events.

Events owns the shared durable Monitor records and the atomic Wait/Monitor commit.
Monitors uses only the versioned `relayEvents` high-level persistence operations; it
never receives SQLite, DSH Session, or Event-store internals.

The plugin does not own:

- Event routing or delivery;
- Wait/Event persistence implementation;
- unrestricted generated code, shell access, or customer browser credentials;
- provider-specific HTTP/browser observers;
- calendar rules, recurring schedules, or natural-language time parsing.

## Observer Contract

An Observer/Detector provider has a stable lowercase `id` and
`observe({ monitor, previous, phase, signal })`. It may own a deterministic
`detect({ monitor, previous, current })`; providers without one use only Core's
domain-neutral detectors. Proposals name the provider they require. Duplicate and
unknown providers fail closed before Wait replacement.

## Bundle Type Registry Contract

A trusted extension registers one immutable definition using
`relayMonitorBundles.registerBundleType()`. The definition uses API version 1, a
namespaced lowercase type ID, a positive integer version, plugin identity, declared
Events, a bounded object parameter schema, capability IDs, supported lifecycle,
complete `en-US` and `zh-CN` presentation, an authorization hook, a live availability
hook, and a factory.

Duplicate `type_id@bundle_version` registrations fail without replacement.
Registration returns an owner-safe idempotent disposer. Discovery returns only a
deeply frozen public projection in deterministic order. It never returns executable
hooks, caller authorization context, unknown origin fields, credential values, or
secret handles. Authorization failure hides the whole entry; invalid or failed health
checks report `unavailable`.

`relayMonitorBundles.instantiateBundleType()` rechecks authorization and live health,
validates parameters against the declared bounded JSON Schema subset, invokes the
factory under a deadline, and validates owner Session, Events, capabilities,
lifecycle, Wait/Monitor identity, size, depth, and JSON shape. It enriches every
artifact with the registered type/version/origin. The root-Agent
`relay_create_monitor_from_type` tool then asks Events to baseline and atomically
commit the proposal; success is returned only after that commit.

Types may declare supported prior versions only with an explicit bounded migration
function. Unsupported versions report incompatibility and never execute migration
code. Migration, factory, and catalog provider outputs use the same JSON graph and
deadline boundaries as creation.

## Custom Bundle Contract

`relay_validate_monitor_bundle` accepts a contract-v1 manifest and source from the
authenticated root Agent. The manifest declares exactly one Event type, one or more
resource-scoped read grants, complete English/Chinese presentation, deterministic
observation and Event schemas, cadence/retry policy, lifecycle, scope, and an
explicitly zoned expiry within 30 days. Project scope is derived with `realpath` and
is reusable only inside the exact canonical root or descendants.

Source is copied to mode-0600 content-addressed storage and re-hashed on every read.
A mode-0600 persistent validation receipt binds source, manifest, authorization,
owner, and expiry. Installation uses only that receipt and atomically baselines and
commits one Wait/Monitor. QuickJS WASM removes host, filesystem, network, process,
module, timer, clock, randomness, and credential authority. `observe` may return one
declared broker request; `detect` has no capabilities and may emit at most one
schema-valid Event/check.

Updates require a new receipt and preserve Monitor/Wait identity; baseline failure
leaves the active version unchanged. Rollback reactivates retained immutable content,
records a fresh baseline, rejects expired versions, and cannot restore broader
grants. Expiry terminalizes the Monitor, cancels only its Wait, emits no Event, and
removes receipt/source only when no other receipt or live Monitor references it.

## Reliability And Security

- Baseline succeeds before Events atomically commits Wait and Monitor records.
- One Monitor has at most one leased check.
- A stable trigger key prevents duplicate Events.
- Bound triggers bypass semantic owner selection and call Events delivery for the
  validated owner.
- Shutdown stops scheduling, aborts/awaits in-flight checks, unregisters provider and
  tools, and leaves recoverable durable state.
- Observations receive an abort signal and have a maximum 30-second deadline.
  Unload releases the check lease without consuming Waits or the failure budget.
- Every baseline and check observation must be JSON-serializable and is bounded to
  256 KiB, depth 32, and 10,000 nodes. Cycles and one-over-limit results fail with
  `observation_too_large` before detector execution or durable commit.
- Cadence is 1–86,400 seconds; jitter cannot exceed the cadence or 3,600 seconds;
  failure thresholds are ordered safe integers up to 100; backoff has at most 20
  entries, each 1–86,400 seconds. Invalid proposals change no Wait or Monitor row.
- Rearming a recurring Monitor does not replay a prior trigger identity, even when
  that identity disappears and later reappears in the observation.
- Custom JavaScript is accepted only through the contract-v1 QuickJS WASM boundary;
  arbitrary host/network/browser/process authority remains unavailable.
- Domain extensions, including Time and GitHub, own their provider-specific
  observation, detection, proposal factories, Events, capabilities, and convenience
  Agent tools.

## Delivery Acceptance

The executable scenario list is in
[`docs/acceptance-scenarios.md`](docs/acceptance-scenarios.md).
