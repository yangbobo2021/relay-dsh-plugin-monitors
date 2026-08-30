# Relay Monitors for DeepSeek Harness

`relay-dsh-plugin-monitors` adds durable bound Monitor execution to
`relay-dsh-plugin-events`. Version `0.1.0` includes the one-shot durable timer,
trusted observer-provider registration, deterministic transition/unseen-item
detectors, leased checks, and lifecycle recovery.

```bash
dsh plugin --profile web add \
  github:yangbobo2021/relay-dsh-plugin-events#main \
  github:yangbobo2021/relay-dsh-plugin-monitors#main
dsh web
```

Generated JavaScript, arbitrary shell/network access, and customer browser
credentials are rejected until a real sandbox and capability broker exist.

See [SPEC.md](SPEC.md) and [delivery scenarios](docs/acceptance-scenarios.md).
Tested official DSH reference:
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
