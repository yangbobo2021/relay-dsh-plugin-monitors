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
  discovery, and localized catalog projection;
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

Custom Bundle artifacts, Capability Providers, and sandbox execution remain gated by
the Relay-level Monitor Bundle Platform acceptance plan. They must not be inferred
from plugin type instantiation.

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
- Generated JavaScript and arbitrary network/browser access are rejected in `0.2.1`.
- Domain extensions, including Time and GitHub, own their provider-specific
  observation, detection, proposal factories, Events, capabilities, and convenience
  Agent tools.

## Delivery Acceptance

The executable scenario list is in
[`docs/acceptance-scenarios.md`](docs/acceptance-scenarios.md).
