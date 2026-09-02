# 面向 DeepSeek Harness 的 Relay Monitors

> 已发布的 `0.2.1` 支持 DSH `0.1.2-alpha.3`。当前源码正在开发 Monitor Core
> `0.3.0`；使用该源码时需要单独安装 Time 扩展。

> **发布通道：** `latest` → `0.2.1`；`next` → `0.2.1-rc.1`。

```bash
npx @deepseek-ai/dsh@0.1.2-alpha.3 plugin --profile web add relay-dsh-plugin-events@0.2.1 relay-dsh-plugin-monitors@0.2.1
npx @deepseek-ai/dsh@0.1.2-alpha.3 web
```

[![DSH 兼容版本](https://img.shields.io/badge/DSH-0.1.1--rc.2%20%7C%200.1.2--alpha.2%20%7C%200.1.2--alpha.3-2f7d68)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) | 中文

`relay-dsh-plugin-monitors` 为 `relay-dsh-plugin-events` 增加可扩展的持久化、绑定式
Monitor 执行。Core 包含实时 Bundle Type 目录、可信 Observer/Detector 注册、通用确定性
转换检测、租约检查和生命周期恢复。Time 与 `relay_schedule_timer` 已迁移到独立的
`relay-dsh-plugin-monitor-time` 扩展。

当前开发源码还通过公共 `relayMonitorBundles` 服务和与 Session 绑定的
`relay_list_monitor_bundle_types` Agent 工具提供实时、双语的 Monitor Bundle Type
目录。目录只列出扩展实际注册的能力，不是静态支持声明。Agent 可以通过
`relay_create_monitor_from_type` 实例化可用类型；Session 归属来自根 Agent，只有基线与
Wait/Monitor 原子提交完成后才返回成功。Agent 自定义 Bundle 执行尚未开放。只安装 Core
时，Bundle Type 目录按设计为空。

旧的 `internal` npm 通道继续用于集成测试，不包含此次兼容保证。请使用上方最新版
DSH 命令中精确的 `0.2.1` 版本，不要替换为 `@internal`。

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
、`0.1.2-alpha.2` / `0a53fb55bea101816fa226bb964ae2bed71c343b`，以及 `0.1.2-alpha.3` / `dd6322d604e00eec1ba5e0c8541159906a21094a`。
