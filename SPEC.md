# Relay DSH Monitors Plugin Specification

Status: Accepted `0.2.1` behavior plus Monitor Bundle Platform development contracts

## Purpose

`relay-dsh-plugin-monitors` contributes durable bound Monitor execution to the
`relayEvents` service. Version `0.2.1` delivers the built-in one-shot timer and a
  trusted observer-provider contract for deterministic `field_transition`,
  `unseen_items`, and `snapshot_changed` detectors.

The development version also publishes the `relayMonitorBundles` API v1 registry
and the `relay_list_monitor_bundle_types` Agent tool. This is the first independently
qualified increment of the Monitor Bundle Platform. Time remains in Core only as a
temporary compatibility path until the Time extension migration qualifies.

## Boundary

The plugin owns:

- Monitor proposal validation and baseline observation;
- observer-provider registry and the built-in clock observer;
- Bundle Type definition validation, registry lifecycle, authorization-filtered
  discovery, and localized catalog projection;
- leased due-check scheduling and run-now;
- deterministic detectors, retry/degraded/failed lifecycle, one-shot completion,
  and explicit recurring rearm;
- the `relay_schedule_timer` Agent tool;
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

An observer provider has a stable lowercase `id` and
`observe({ monitor, previous, phase, signal })`. Proposals name the provider they
require. Duplicate providers fail closed. The built-in `clock` provider accepts only
the `deadline_reached` detector. Unknown providers and detector/provider mismatch fail
before Wait replacement.

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

This increment exposes discovery only. Type instantiation, custom Bundle artifacts,
Capability Providers, sandbox execution, and Time/GitHub migration remain gated by
the Relay-level Monitor Bundle Platform acceptance plan and must not be inferred from
the presence of the catalog.

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
- Timers accept either one positive whole-second relative delay or one future RFC3339
  deadline with an explicit timezone. The resolved UTC deadline and original intent
  are persisted; ambiguous local times and past deadlines fail before registration.

## Delivery Acceptance

The executable scenario list is in
[`docs/acceptance-scenarios.md`](docs/acceptance-scenarios.md).
