# Relay Monitors for DeepSeek Harness

`relay-dsh-plugin-monitors` adds durable bound Monitor execution to
`relay-dsh-plugin-events`. Version `0.1.0` includes the one-shot durable timer,
trusted observer-provider registration, deterministic transition/unseen-item
detectors, leased checks, and lifecycle recovery.

```bash
dsh plugin --profile web add \
  ./relay-dsh-plugin-events-0.1.0.tgz \
  ./relay-dsh-plugin-monitors-0.1.0.tgz
dsh web
```

Generated JavaScript, arbitrary shell/network access, and customer browser
credentials are rejected until a real sandbox and capability broker exist.

Build this repository with `DSH_ROOT` pointing to a prepared official DSH checkout:
`npm ci --ignore-scripts && npm run verify && npm pack`. Install the resulting
tarballs together. Raw GitHub source does not contain built `lib/`; npm publication
is not claimed. Observer calls are bounded to at most 30 seconds and receive an
abort signal on timeout or unload; cancellation releases the lease without counting
as a business observation failure.

See [SPEC.md](SPEC.md) and [delivery scenarios](docs/acceptance-scenarios.md).
Tested official DSH reference:
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
