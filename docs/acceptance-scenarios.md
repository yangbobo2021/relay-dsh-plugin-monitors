# Monitors Delivery Acceptance Scenarios

Official DSH reference: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

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

