import { Service } from "@deepseek-ai/cordis";

import { assertValidParameterSchema, validateParameters } from "./parameter-schema.mjs";
import { validateSandboxOutput } from "./sandbox.mjs";

const PROVIDER_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9][a-z0-9-]*)+$/u;
const OPERATION_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9][a-z0-9-]*)*$/u;

export class RelayMonitorCapabilityRegistry extends Service {
  apiVersion = 1;
  #providers = new Map();
  #listeners = new Set();
  #operationTimeoutMs;

  constructor(ctx, { operationTimeoutMs = 30_000 } = {}) {
    super(ctx, "relayMonitorCapabilities");
    this.#operationTimeoutMs = positiveInteger(operationTimeoutMs, 30_000);
  }

  registerCapabilityProvider = definition => {
    const registration = normalizeCapabilityProvider(definition);
    if (this.#providers.has(registration.id)) throw new Error(`monitor capability provider ${registration.id} is already registered`);
    this.#providers.set(registration.id, registration);
    this.#notify({ id: registration.id, state: "registered" });
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      registration.active = false;
      if (this.#providers.get(registration.id) === registration) {
        this.#providers.delete(registration.id);
        this.#notify({ id: registration.id, state: "unregistered" });
      }
    };
  };

  hasCapabilityProvider = providerId => this.#providers.has(providerId);

  subscribe = listener => {
    if (typeof listener !== "function") throw new TypeError("monitor capability listener must be a function");
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  listCapabilityProviders = async ({ authorization = {} } = {}) => {
    const result = [];
    for (const registration of this.#providers.values()) {
      if (!await authorized(registration, authorization, null)) continue;
      let status = "available";
      try {
        const health = registration.health ? await registration.health(authorization) : "available";
        status = health === "available" ? "available" : "unavailable";
      } catch { status = "unavailable"; }
      result.push(Object.freeze({
        api_version: 1,
        id: registration.id,
        provider_version: registration.provider_version,
        operations: Object.freeze(Object.keys(registration.operations).sort()),
        status,
      }));
    }
    return Object.freeze(result.sort((left, right) => left.id.localeCompare(right.id, "en")));
  };

  validateGrants = async ({ grants, authorization = {} } = {}) => {
    if (!Array.isArray(grants) || grants.length === 0) throw capabilityError("capability_denied", "Monitor capability grants are required");
    for (const grant of grants) {
      validateCapabilityRequest(grant);
      const registration = this.#providers.get(grant.provider);
      if (!registration?.active) throw capabilityError("provider_unavailable", `Monitor capability provider ${grant.provider} is unavailable`);
      const operation = registration.operations[grant.operation];
      if (!operation) throw capabilityError("operation_unavailable", `Monitor capability operation ${grant.operation} is unavailable`);
      validateParameters(operation.parameters, grant.arguments);
      if (!await authorized(registration, authorization, grant)) throw capabilityError("capability_denied", "Monitor capability grant is not authorized");
    }
    return true;
  };

  invoke = async ({ request, grants, authorization = {}, signal } = {}) => {
    validateCapabilityRequest(request);
    if (!Array.isArray(grants)) throw capabilityError("capability_denied", "Monitor capability grants are required");
    const grant = grants.find(candidate => requestWithinGrant(request, candidate));
    if (!grant) throw capabilityError("capability_denied", "Monitor capability request exceeds its approved grant");
    const registration = this.#providers.get(request.provider);
    if (!registration?.active) throw capabilityError("provider_unavailable", `Monitor capability provider ${request.provider} is unavailable`);
    const operation = registration.operations[request.operation];
    if (!operation) throw capabilityError("operation_unavailable", `Monitor capability operation ${request.operation} is unavailable`);
    validateParameters(operation.parameters, request.arguments);
    if (!await authorized(registration, authorization, request)) throw capabilityError("capability_denied", "Monitor capability request is not authorized");

    const timeout = new AbortController();
    const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    const timer = setTimeout(() => timeout.abort(capabilityError("provider_timeout", "Monitor capability provider timed out")), this.#operationTimeoutMs);
    let onAbort;
    try {
      const cancelled = new Promise((_, reject) => {
        onAbort = () => reject(combined.reason ?? capabilityError("cancelled", "Monitor capability request was cancelled"));
        combined.addEventListener("abort", onAbort, { once: true });
        if (combined.aborted) onAbort();
      });
      const result = await Promise.race([
        Promise.resolve().then(() => registration.execute({
          operation: request.operation,
          arguments: deepFreeze(structuredClone(request.arguments)),
          authorization: deepFreeze(structuredClone(authorization)),
          signal: combined,
        })),
        cancelled,
      ]);
      if (!registration.active) throw capabilityError("provider_unavailable", "Monitor capability provider unloaded during execution");
      validateParameters(operation.result, result);
      validateSandboxOutput(result, 262_144);
      return structuredClone(result);
    } finally {
      clearTimeout(timer);
      if (onAbort) combined.removeEventListener("abort", onAbort);
    }
  };

  #notify(change) {
    for (const listener of this.#listeners) {
      try { listener(change); } catch {}
    }
  }
}

export function normalizeCapabilityProvider(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new TypeError("monitor capability provider definition is required");
  if (definition.api_version !== 1) throw new TypeError("monitor capability provider API version must be 1");
  if (!PROVIDER_ID.test(definition.id ?? "")) throw new TypeError("monitor capability provider requires a namespaced lowercase id");
  if (!Number.isSafeInteger(definition.provider_version) || definition.provider_version < 1) throw new TypeError("monitor capability provider version must be positive");
  if (!definition.operations || typeof definition.operations !== "object" || Array.isArray(definition.operations) || Object.keys(definition.operations).length === 0) {
    throw new TypeError("monitor capability provider operations are required");
  }
  const operations = {};
  for (const [id, operation] of Object.entries(definition.operations)) {
    if (!OPERATION_ID.test(id)) throw new TypeError("monitor capability operation id is invalid");
    if (!operation || operation.class !== "read") throw new TypeError("monitor capability operations must be read-only");
    assertValidParameterSchema(operation.parameters, `capability ${id} parameter schema`);
    assertValidParameterSchema(operation.result, `capability ${id} result schema`);
    operations[id] = deepFreeze(structuredClone({
      class: "read",
      parameters: operation.parameters,
      result: operation.result,
    }));
  }
  if (typeof definition.authorize !== "function") throw new TypeError("monitor capability provider authorize() is required");
  if (typeof definition.execute !== "function") throw new TypeError("monitor capability provider execute() is required");
  if (definition.health !== undefined && typeof definition.health !== "function") throw new TypeError("monitor capability provider health must be a function");
  return {
    id: definition.id,
    provider_version: definition.provider_version,
    operations: deepFreeze(operations),
    authorize: definition.authorize,
    execute: definition.execute,
    health: definition.health,
    active: true,
  };
}

function validateCapabilityRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)
    || !PROVIDER_ID.test(request.provider ?? "") || !OPERATION_ID.test(request.operation ?? "")
    || !request.arguments || typeof request.arguments !== "object" || Array.isArray(request.arguments)) {
    throw capabilityError("invalid_request", "Monitor capability request is invalid");
  }
}

function requestWithinGrant(request, grant) {
  return grant?.provider === request.provider && grant?.operation === request.operation
    && isSubset(request.arguments, grant.arguments ?? {});
}

function isSubset(value, allowed) {
  if (Array.isArray(value) || Array.isArray(allowed)) return JSON.stringify(value) === JSON.stringify(allowed);
  if (value && typeof value === "object") {
    if (!allowed || typeof allowed !== "object") return false;
    return Object.entries(value).every(([key, child]) => key in allowed && isSubset(child, allowed[key]));
  }
  return Object.is(value, allowed);
}

async function authorized(registration, authorization, request) {
  try { return await registration.authorize({ authorization, request }) === true; }
  catch { return false; }
}

function capabilityError(errorClass, message) {
  return Object.assign(new Error(message), { name: "MonitorCapabilityError", errorClass });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
