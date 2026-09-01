# 面向 DeepSeek Harness 的 Relay Monitors

> **现已支持最新 DSH `0.1.2-alpha.2`。** 同一插件版本已在 DSH `0.1.2-alpha.2` 与 `0.1.1-rc.2` 上完成兼容验证。[安装插件，立即体验最新版 DSH](https://www.npmjs.com/package/relay-dsh-plugin-monitors) · [兼容性详情](docs/dsh-0.1.2-alpha.2.md)。

```bash
npx @deepseek-ai/dsh@0.1.2-alpha.2 plugin --profile web add relay-dsh-plugin-events@0.2.0 relay-dsh-plugin-monitors@0.2.0
npx @deepseek-ai/dsh@0.1.2-alpha.2 web
```

[![DSH 兼容版本](https://img.shields.io/badge/DSH-0.1.1--rc.2%20%7C%200.1.2--alpha.2-2f7d68)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) | 中文

`relay-dsh-plugin-monitors` 为 `relay-dsh-plugin-events` 增加持久化、绑定式 Monitor
执行。当前版本包含一次性持久计时器、可信观察器 Provider 注册、确定性的状态转换与
未见项目检测器、租约检查以及生命周期恢复。

旧的 `internal` npm 通道继续用于集成测试，不包含此次兼容保证。请使用上方最新版
DSH 命令中精确的 `0.2.0` 版本，不要替换为 `@internal`。

```bash
dsh plugin --profile web add --save-exact \
  relay-dsh-plugin-events@internal \
  relay-dsh-plugin-monitors@internal
dsh web
```

在具备真实沙箱和能力代理之前，插件拒绝生成式 JavaScript、任意 Shell 或网络访问，
也拒绝使用客户浏览器凭据。

构建时将 `DSH_ROOT` 指向准备好的官方 DSH 只读检出，然后执行
`npm ci --ignore-scripts && npm run verify && npm pack`，并同时安装生成的 tarball。
npm 包包含已构建的 `lib/`，原始 GitHub 源码不包含。观察器调用最长 30 秒，超时或
卸载时会收到 abort signal；取消会释放租约，不会记为一次业务观察失败。

详见 [SPEC.md](SPEC.md) 与[投递场景](docs/acceptance-scenarios.md)。

已验证的官方 DSH：`0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
与 `0.1.2-alpha.2` / `0a53fb55bea101816fa226bb964ae2bed71c343b`。
