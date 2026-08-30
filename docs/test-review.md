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
