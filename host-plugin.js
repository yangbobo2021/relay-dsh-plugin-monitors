import { installMonitorAgentBridge } from "./agent-bridge.js";
import { RelayMonitorsController } from "./src/controller.mjs";
import { RelayMonitorObserverRegistry } from "./src/observer-registry.mjs";

export const name = "relay-dsh-plugin-monitors";
export const inject = ["agents", "tools"];

export function apply(ctx, config = {}) {
  const observers = new RelayMonitorObserverRegistry(ctx);
  const fiber = ctx.inject(["relayEvents"], scope => {
    const controller = new RelayMonitorsController({
      events: scope.relayEvents,
      observers,
      logger: scope.logger,
      pollIntervalMs: config.pollIntervalMs,
    });
    scope.effect(() => scope.relayEvents.registerMonitorProvider(controller.provider), "relay monitor provider");
    scope.effect(() => {
      controller.start();
      return () => controller.stop();
    }, "relay monitor scheduler");
    const attach = agent => {
      if (!scope.agents.roots().includes(agent)) return;
      installMonitorAgentBridge(agent.ctx, {
        sessionId: agent.id,
        scheduleTimer: async input => {
          const proposal = controller.createTimer(input);
          await scope.relayEvents.registerWaits(proposal);
          return proposal.timer;
        },
      });
    };
    scope.effect(() => scope.on("agent/created", ({ agent }) => attach(agent)), "relay monitor agent bridge");
    for (const agent of scope.agents.roots()) attach(agent);
  });
  ctx.effect(() => () => fiber.dispose(), "relay monitor injection");
}

export { RelayMonitorObserverRegistry } from "./src/observer-registry.mjs";
