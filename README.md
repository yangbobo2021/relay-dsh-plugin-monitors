# Relay Monitors for DeepSeek Harness

> **Now supports the latest DSH `0.1.2-alpha.3`.** Plugin `0.2.1` is verified on DSH `0.1.2-alpha.3`, `0.1.2-alpha.2`, and `0.1.1-rc.2`. [Install it and try the latest DSH](https://www.npmjs.com/package/relay-dsh-plugin-monitors) · [Compatibility details](docs/dsh-0.1.2-alpha.3.md).

> **Release channels:** `latest` → `0.2.1`; `next` → `0.2.1-rc.1`.

```bash
npx @deepseek-ai/dsh@0.1.2-alpha.3 plugin --profile web add relay-dsh-plugin-events@0.2.1 relay-dsh-plugin-monitors@0.2.1
npx @deepseek-ai/dsh@0.1.2-alpha.3 web
```

[![DSH compatibility](https://img.shields.io/badge/DSH-0.1.1--rc.2%20%7C%200.1.2--alpha.2%20%7C%200.1.2--alpha.3-2f7d68)](https://github.com/deepseek-ai/deepseek-harness)

English | [中文](README.zh.md)

`relay-dsh-plugin-monitors` adds durable bound Monitor execution to
`relay-dsh-plugin-events`. The current internal build includes the one-shot durable timer,
trusted observer-provider registration, deterministic transition/unseen-item
detectors, leased checks, and lifecycle recovery.

The development source additionally exposes a live, localized Monitor Bundle Type
catalog through the public `relayMonitorBundles` service and the Session-bound
`relay_list_monitor_bundle_types` Agent tool. The catalog lists capabilities that
extensions have actually registered; it is not a static support claim. Bundle
instantiation and Agent-authored Bundle execution are not yet exposed by this
increment.

The older `internal` npm channel remains available for integration testing and
does not carry this compatibility guarantee. Use the exact `0.2.1`
versions in the latest-DSH command above; do not substitute `@internal`.

```bash
dsh plugin --profile web add --save-exact \
  relay-dsh-plugin-events@internal \
  relay-dsh-plugin-monitors@internal
dsh web
```

Generated JavaScript, arbitrary shell/network access, and customer browser
credentials are rejected until a real sandbox and capability broker exist.

Build this repository with `DSH_ROOT` pointing to a prepared official DSH checkout:
`npm ci --ignore-scripts && npm run verify && npm pack`. Install the resulting
tarballs together. The npm package includes built `lib/`; raw GitHub source does
not. Observer calls are bounded to at most 30 seconds and receive an abort signal
on timeout or unload; cancellation releases the lease without counting as a
business observation failure.

See [SPEC.md](SPEC.md) and [delivery scenarios](docs/acceptance-scenarios.md).
Tested official DSH references: `0.1.1-rc.2` at
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`, `0.1.2-alpha.2` at
`0a53fb55bea101816fa226bb964ae2bed71c343b`, and `0.1.2-alpha.3` at `dd6322d604e00eec1ba5e0c8541159906a21094a`.
