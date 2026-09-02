import { installMonitorAgentBridge } from "./agent-bridge.js";
import { RelayMonitorsController } from "./src/controller.mjs";
import { RelayMonitorBundleRegistry } from "./src/bundle-registry.mjs";
import { RelayMonitorObserverRegistry } from "./src/observer-registry.mjs";

export const name = "relay-dsh-plugin-monitors";
export const inject = ["agents", "tools"];

export function apply(ctx, config = {}) {
  const bundles = new RelayMonitorBundleRegistry(ctx);
  const observers = new RelayMonitorObserverRegistry(ctx);
  const fiber = ctx.inject(["relayEvents"], scope => {
    const controller = new RelayMonitorsController({
      events: scope.relayEvents,
      observers,
      logger: scope.logger,
      pollIntervalMs: config.pollIntervalMs,
      observationTimeoutMs: config.observationTimeoutMs,
    });
    scope.effect(() => scope.relayEvents.registerMonitorProvider(controller.provider), "relay monitor provider");
    scope.effect(() => {
      controller.start();
      return () => controller.stop();
    }, "relay monitor scheduler");
    const attach = agent => {
      if (!scope.agents.roots().includes(agent)) return;
      scope.effect(() => installMonitorAgentBridge(agent.ctx, {
        sessionId: agent.id,
        listBundleTypes: input => bundles.listBundleTypes(input),
      }), "relay monitor tools");
    };
    scope.effect(() => scope.on("agent/created", ({ agent }) => attach(agent)), "relay monitor agent bridge");
    for (const agent of scope.agents.roots()) attach(agent);
  });
  ctx.effect(() => () => fiber.dispose(), "relay monitor injection");
}

export { RelayMonitorBundleRegistry } from "./src/bundle-registry.mjs";
export { RelayMonitorObserverRegistry } from "./src/observer-registry.mjs";
