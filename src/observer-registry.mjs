import { Service } from "@deepseek-ai/cordis";

const PROVIDER_ID = /^[a-z][a-z0-9._-]{0,63}$/u;

export class RelayMonitorObserverRegistry extends Service {
  apiVersion = 1;
  providers = new Map();

  constructor(ctx, { clock = () => new Date() } = {}) {
    super(ctx, "relayMonitorObservers");
    this.providers.set("clock", {
      id: "clock",
      async observe() { return { observed_at: clock().toISOString() }; },
    });
  }

  register(provider) {
    validateObserverProvider(provider);
    if (this.providers.has(provider.id)) throw new Error(`monitor observer ${provider.id} is already registered`);
    this.providers.set(provider.id, provider);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id);
    };
  }

  async observe(input) {
    const providerId = resolveObserverProvider(input.monitor);
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`monitor observer ${providerId} is not registered`);
    validateProviderDetector(providerId, input.monitor.detector);
    return provider.observe(input);
  }
}

export function validateObserverProvider(provider) {
  if (!provider || typeof provider !== "object" || !PROVIDER_ID.test(provider.id ?? "")) {
    throw new TypeError("monitor observer requires a lowercase stable id");
  }
  if (typeof provider.observe !== "function") throw new TypeError("monitor observer requires observe()");
  return provider;
}

export function resolveObserverProvider(monitor) {
  const explicit = monitor.observer?.provider;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  if (monitor.detector?.kind === "deadline_reached") return "clock";
  throw new Error(`monitor ${monitor.monitor_id ?? "proposal"} requires observer.provider`);
}

export function validateArtifactBoundary(monitor) {
  const kind = monitor.artifact?.kind ?? "builtin";
  if (kind !== "builtin" && kind !== "trusted-provider") {
    throw new Error(`monitor artifact kind ${kind} is not allowed`);
  }
  for (const forbidden of ["shell", "browser", "network", "javascript", "generated-js"]) {
    if (kind === forbidden || monitor.capabilities?.[forbidden] === true) {
      throw new Error(`monitor capability ${forbidden} is not allowed`);
    }
  }
}

function validateProviderDetector(providerId, detector) {
  if (providerId === "clock" && detector?.kind !== "deadline_reached") {
    throw new Error("clock observer supports only deadline_reached");
  }
}
