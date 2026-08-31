# Relay Monitors for DeepSeek Harness

> 未发布适配：本分支已迁移到 DSH `0.1.2-alpha.2`。npm 版本和标签尚未更新；下方已发布版本的安装示例不代表新版兼容性。见[适配说明](docs/dsh-0.1.2-alpha.2.md)。

`relay-dsh-plugin-monitors` adds durable bound Monitor execution to
`relay-dsh-plugin-events`. The current internal build includes the one-shot durable timer,
trusted observer-provider registration, deterministic transition/unseen-item
detectors, leased checks, and lifecycle recovery.

The `internal` npm channel is public for integration testing. It has no stability
or compatibility guarantee and must not be treated as `latest`, `next`, or a
production release.

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
Tested official DSH reference:
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
