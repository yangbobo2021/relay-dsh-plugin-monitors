import { installMonitorAgentBridge } from "./agent-bridge.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { MonitorArtifactStore } from "./src/artifact-store.mjs";
import { RelayMonitorsController } from "./src/controller.mjs";
import { RelayMonitorBundleRegistry } from "./src/bundle-registry.mjs";
import { RelayMonitorCapabilityRegistry } from "./src/capability-registry.mjs";
import { RelayCustomMonitorBundles } from "./src/custom-bundles.mjs";
import { RelayMonitorObserverRegistry } from "./src/observer-registry.mjs";
import { MonitorBundleSandbox } from "./src/sandbox.mjs";

export const name = "relay-dsh-plugin-monitors";
export const inject = ["agents", "tools"];

export function apply(ctx, config = {}) {
  const bundles = new RelayMonitorBundleRegistry(ctx);
  const capabilities = new RelayMonitorCapabilityRegistry(ctx, { operationTimeoutMs: config.capabilityTimeoutMs });
  const observers = new RelayMonitorObserverRegistry(ctx);
  const artifacts = new MonitorArtifactStore(config.artifactDirectory
    ?? join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "relay-monitor-artifacts"));
  const sandbox = new MonitorBundleSandbox(config.sandbox);
  const custom = new RelayCustomMonitorBundles({ artifacts, sandbox, capabilities, ...(config.clock ? { clock: config.clock } : {}) });
  ctx.effect(() => observers.register(custom.createRuntimeProvider()), "relay custom Bundle runtime");
  ctx.effect(() => bundles.registerCatalogProvider({
    id: "relay.agent-bundles",
    listBundleTypes: input => custom.listBundleTypes(input),
  }), "relay custom Bundle catalog");
  const fiber = ctx.inject(["relayEvents"], scope => {
    const controller = new RelayMonitorsController({
      events: scope.relayEvents,
      observers,
      capabilities,
      maintenance: () => custom.cleanupExpired({
        activeArtifactHashes: scope.relayEvents.listWaits()
          .flatMap(registration => registration.monitors ?? [])
          .filter(monitor => new Set(["active", "degraded", "paused"]).has(monitor.state))
          .map(monitor => monitor.artifact?.sha256)
          .filter(Boolean),
      }),
      logger: config.logger ?? scope.logger,
      pollIntervalMs: config.pollIntervalMs,
      observationTimeoutMs: config.observationTimeoutMs,
    });
    scope.effect(() => scope.relayEvents.registerMonitorProvider(controller.provider), "relay monitor provider");
    scope.effect(() => scope.relayEvents.registerBundleCatalogProvider({
      id: "relay.monitors",
      async list({ locale }) {
        const roots = scope.agents.roots();
        const authorizations = roots.length > 0
          ? roots.map(agent => ({ sessionId: agent.id, cwd: agent.session?.header?.cwd ?? null }))
          : [{}];
        const visible = new Map();
        for (const authorization of authorizations) {
          for (const entry of await bundles.listBundleTypes({ locale, authorization })) {
            const key = entry.origin.kind === "agent"
              ? `${entry.type_id}@${entry.bundle_version}:${entry.artifact_hash}`
              : `${entry.type_id}@${entry.bundle_version}`;
            if (!visible.has(key)) visible.set(key, entry);
          }
        }
        return [...visible.values()];
      },
    }), "relay Monitor Bundle management catalog");
    scope.effect(() => {
      controller.start();
      return () => controller.stop();
    }, "relay monitor scheduler");
    const attach = agent => {
      if (!scope.agents.roots().includes(agent)) return;
      scope.effect(() => installMonitorAgentBridge(agent.ctx, {
        sessionId: agent.id,
        authorization: { cwd: agent.session?.header?.cwd ?? null },
        listBundleTypes: input => bundles.listBundleTypePage(input),
        createBundleFromType: async input => {
          const proposal = await bundles.instantiateBundleType(input);
          const registration = await scope.relayEvents.registerWaits(proposal);
          const monitorIds = proposal.monitors.map(monitor => monitor.monitor_id);
          const waitIds = proposal.waits.map(wait => wait.wait_id);
          return {
            monitorIds,
            waitIds,
            nextCheckAt: registration.monitors.filter(monitor => monitorIds.includes(monitor.monitor_id))
              .map(monitor => monitor.next_check_at).filter(Boolean).sort()[0] ?? null,
          };
        },
        validateCustomBundle: input => custom.validate(input),
        installCustomBundle: input => custom.install({
          ...input,
          registerWaits: proposal => scope.relayEvents.registerWaits(proposal),
        }),
        updateCustomBundle: input => custom.update({
          ...input,
          inspectMonitor: monitorId => scope.relayEvents.inspectMonitor(monitorId),
          rebaselineMonitor: (monitorId, proposal, options) => scope.relayEvents.rebaselineMonitor(monitorId, proposal, options),
        }),
        rollbackCustomBundle: input => custom.rollback({
          ...input,
          inspectMonitor: monitorId => scope.relayEvents.inspectMonitor(monitorId),
          rebaselineMonitor: (monitorId, proposal, options) => scope.relayEvents.rebaselineMonitor(monitorId, proposal, options),
        }),
      }), "relay monitor tools");
    };
    scope.effect(() => scope.on("agent/created", ({ agent }) => attach(agent)), "relay monitor agent bridge");
    for (const agent of scope.agents.roots()) attach(agent);
  });
  ctx.effect(() => () => fiber.dispose(), "relay monitor injection");
}

export { RelayMonitorBundleRegistry } from "./src/bundle-registry.mjs";
export { RelayMonitorCapabilityRegistry } from "./src/capability-registry.mjs";
export { RelayCustomMonitorBundles } from "./src/custom-bundles.mjs";
export { MonitorArtifactStore } from "./src/artifact-store.mjs";
export { MonitorBundleSandbox } from "./src/sandbox.mjs";
export { RelayMonitorObserverRegistry } from "./src/observer-registry.mjs";
