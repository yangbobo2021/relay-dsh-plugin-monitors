# Relay Monitors for DeepSeek Harness

> **Now supports the latest DSH `0.1.2-alpha.2`.** The same plugin release is verified on DSH `0.1.2-alpha.2` and `0.1.1-rc.2`. [Install it and try the latest DSH](https://www.npmjs.com/package/relay-dsh-plugin-monitors) · [Compatibility details](docs/dsh-0.1.2-alpha.2.md).

```bash
npx @deepseek-ai/dsh@0.1.2-alpha.2 plugin --profile web add relay-dsh-plugin-events@0.2.0-rc.1 relay-dsh-plugin-monitors@0.2.0-rc.1
npx @deepseek-ai/dsh@0.1.2-alpha.2 web
```

[![DSH compatibility](https://img.shields.io/badge/DSH-0.1.1--rc.2%20%7C%200.1.2--alpha.2-2f7d68)](https://github.com/deepseek-ai/deepseek-harness)

English | [中文](README.zh.md)

`relay-dsh-plugin-monitors` adds durable bound Monitor execution to
`relay-dsh-plugin-events`. The current internal build includes the one-shot durable timer,
trusted observer-provider registration, deterministic transition/unseen-item
detectors, leased checks, and lifecycle recovery.

The older `internal` npm channel remains available for integration testing and
does not carry this compatibility guarantee. Use the exact `0.2.0-rc.1`
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
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` and `0.1.2-alpha.2` at
`0a53fb55bea101816fa226bb964ae2bed71c343b`.
