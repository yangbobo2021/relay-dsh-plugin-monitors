# Relay DSH Monitors Plugin Specification

Status: Accepted for `0.1.0`

## Purpose

`relay-dsh-plugin-monitors` contributes durable bound Monitor execution to the
`relayEvents` service. Version `0.1.0` delivers the built-in one-shot timer and a
trusted observer-provider contract for deterministic `field_transition` and
`unseen_items` detectors.

## Boundary

The plugin owns:

- Monitor proposal validation and baseline observation;
- observer-provider registry and the built-in clock observer;
- leased due-check scheduling and run-now;
- deterministic detectors, retry/degraded/failed lifecycle, one-shot completion,
  and explicit recurring rearm;
- the `relay_schedule_timer` Agent tool;
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
- Rearming a recurring Monitor does not replay a prior trigger identity, even when
  that identity disappears and later reappears in the observation.
- Generated JavaScript and arbitrary network/browser access are rejected in `0.1.0`.

## Delivery Acceptance

The executable scenario list is in
[`docs/acceptance-scenarios.md`](docs/acceptance-scenarios.md).
