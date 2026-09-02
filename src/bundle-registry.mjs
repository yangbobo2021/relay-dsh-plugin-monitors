import { Service } from "@deepseek-ai/cordis";

const TYPE_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)+$/u;
const STABLE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9][a-z0-9-]*)*$/u;
const EVENT_TYPE = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_-]*)+$/u;
const STATUSES = new Set(["available", "configuration_required", "unavailable", "incompatible"]);
const LIFECYCLES = new Set(["one_shot", "recurring"]);
const REQUIRED_LOCALES = ["en-US", "zh-CN"];
const LOCALIZED_FIELDS = ["name", "description", "permissions", "remediation"];

export class RelayMonitorBundleRegistry extends Service {
  apiVersion = 1;
  #registrations = new Map();

  constructor(ctx) {
    super(ctx, "relayMonitorBundles");
  }

  registerBundleType(definition) {
    const registration = normalizeBundleType(definition);
    const key = registrationKey(registration);
    if (this.#registrations.has(key)) {
      throw new Error(`monitor Bundle Type ${registration.type_id}@${registration.bundle_version} is already registered`);
    }
    this.#registrations.set(key, registration);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.#registrations.get(key) === registration) this.#registrations.delete(key);
    };
  }

  getBundleType(typeId, bundleVersion) {
    const registration = this.#registrations.get(registrationKey({ type_id: typeId, bundle_version: bundleVersion }));
    return registration?.definition;
  }

  async listBundleTypes({ locale = "en-US", authorization = Object.freeze({}) } = {}) {
    const selectedLocale = locale === "zh-CN" ? "zh-CN" : "en-US";
    const visible = [];
    for (const registration of this.#registrations.values()) {
      if (!await isAuthorized(registration, authorization)) continue;
      const status = await resolveStatus(registration, authorization);
      visible.push(toCatalogEntry(registration, selectedLocale, status));
    }
    visible.sort((left, right) => left.type_id.localeCompare(right.type_id, "en") || left.bundle_version - right.bundle_version);
    return Object.freeze(visible);
  }
}

export function normalizeBundleType(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new TypeError("monitor Bundle Type definition must be an object");
  }
  if (definition.api_version !== 1) throw new TypeError("monitor Bundle Type API version must be 1");
  if (!TYPE_ID.test(definition.type_id ?? "")) throw new TypeError("monitor Bundle Type requires a lowercase namespaced id");
  if (!Number.isSafeInteger(definition.bundle_version) || definition.bundle_version < 1) {
    throw new TypeError("monitor Bundle Type version must be a positive integer");
  }
  validateOrigin(definition.origin);
  validateStringArray(definition.event_types, "Event", EVENT_TYPE);
  validateParameterSchema(definition.parameter_schema);
  validateStringArray(definition.capabilities, "capability", STABLE_ID, { allowEmpty: true });
  validateStringArray(definition.lifecycle, "lifecycle", null, { allowed: LIFECYCLES });
  validateLocales(definition.locales);
  if (typeof definition.create !== "function") throw new TypeError("monitor Bundle Type requires a factory create()");
  if (definition.authorize !== undefined && typeof definition.authorize !== "function") {
    throw new TypeError("monitor Bundle Type authorize must be a function");
  }
  if (definition.availability !== undefined && typeof definition.availability !== "function") {
    throw new TypeError("monitor Bundle Type availability must be a function");
  }

  const publicData = deepFreeze(structuredClone({
    api_version: 1,
    type_id: definition.type_id,
    bundle_version: definition.bundle_version,
    origin: {
      kind: "plugin",
      plugin_id: definition.origin.plugin_id,
      plugin_version: definition.origin.plugin_version,
    },
    event_types: definition.event_types,
    parameter_schema: definition.parameter_schema,
    capabilities: definition.capabilities,
    lifecycle: definition.lifecycle,
    locales: definition.locales,
  }));
  return Object.freeze({
    ...publicData,
    definition: Object.freeze({
      ...publicData,
      create: definition.create,
      authorize: definition.authorize,
      availability: definition.availability,
    }),
    authorize: definition.authorize,
    availability: definition.availability,
  });
}

function validateOrigin(origin) {
  if (!origin || typeof origin !== "object" || Array.isArray(origin) || origin.kind !== "plugin") {
    throw new TypeError("monitor Bundle Type origin must identify a plugin");
  }
  if (!STABLE_ID.test(origin.plugin_id ?? "")) throw new TypeError("monitor Bundle Type origin requires a stable plugin id");
  if (typeof origin.plugin_version !== "string" || !origin.plugin_version.trim() || origin.plugin_version.length > 128) {
    throw new TypeError("monitor Bundle Type origin requires a plugin version");
  }
}

function validateParameterSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || schema.type !== "object") {
    throw new TypeError("monitor Bundle Type parameter schema must describe an object");
  }
  validateBoundedJson(schema, "monitor Bundle Type parameter schema", { maxBytes: 65_536, maxDepth: 16, maxNodes: 2_000 });
}

function validateLocales(locales) {
  if (!locales || typeof locales !== "object" || Array.isArray(locales)) {
    throw new TypeError("monitor Bundle Type locales are required");
  }
  for (const locale of REQUIRED_LOCALES) {
    const value = locales[locale];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError(`monitor Bundle Type locale ${locale} is required`);
    }
    for (const field of LOCALIZED_FIELDS) {
      if (typeof value[field] !== "string" || !value[field].trim() || value[field].length > 2_000) {
        throw new TypeError(`monitor Bundle Type locale ${locale}.${field} must be a non-empty string`);
      }
    }
  }
}

function validateStringArray(value, label, pattern, { allowEmpty = false, allowed } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 128) {
    throw new TypeError(`monitor Bundle Type ${label} declarations must be a bounded array`);
  }
  const unique = new Set();
  for (const item of value) {
    if (typeof item !== "string" || item.length > 128 || (pattern && !pattern.test(item)) || (allowed && !allowed.has(item))) {
      throw new TypeError(`monitor Bundle Type ${label} declaration is invalid`);
    }
    if (unique.has(item)) throw new TypeError(`monitor Bundle Type ${label} declarations must be unique`);
    unique.add(item);
  }
}

function validateBoundedJson(value, label, { maxBytes, maxDepth, maxNodes }) {
  const stack = [{ value, depth: 0 }];
  const seen = new Set();
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    if (current.depth > maxDepth) throw new TypeError(`${label} exceeds the depth limit`);
    if (current.value && typeof current.value === "object") {
      if (seen.has(current.value)) throw new TypeError(`${label} contains a cycle`);
      seen.add(current.value);
      for (const child of Object.values(current.value)) {
        nodes += 1;
        if (nodes > maxNodes) throw new TypeError(`${label} exceeds the field limit`);
        if (child && typeof child === "object") stack.push({ value: child, depth: current.depth + 1 });
        else if (!["string", "number", "boolean", "undefined"].includes(typeof child) && child !== null) {
          throw new TypeError(`${label} must contain only JSON values`);
        }
      }
    }
  }
  let encoded;
  try { encoded = JSON.stringify(value); }
  catch { throw new TypeError(`${label} must be JSON serializable`); }
  if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > maxBytes) throw new TypeError(`${label} exceeds the size limit`);
}

async function isAuthorized(registration, authorization) {
  if (!registration.authorize) return true;
  try { return await registration.authorize(authorization) === true; }
  catch { return false; }
}

async function resolveStatus(registration, authorization) {
  if (!registration.availability) return "available";
  try {
    const result = await registration.availability(authorization);
    const status = typeof result === "string" ? result : result?.status;
    return STATUSES.has(status) ? status : "unavailable";
  } catch {
    return "unavailable";
  }
}

function toCatalogEntry(registration, locale, status) {
  const localized = registration.locales[locale];
  return deepFreeze({
    api_version: registration.api_version,
    type_id: registration.type_id,
    bundle_version: registration.bundle_version,
    origin: structuredClone(registration.origin),
    event_types: [...registration.event_types],
    parameter_schema: structuredClone(registration.parameter_schema),
    capabilities: [...registration.capabilities],
    lifecycle: [...registration.lifecycle],
    status,
    locale,
    name: localized.name,
    description: localized.description,
    permissions: localized.permissions,
    remediation: localized.remediation,
  });
}

function registrationKey(value) {
  return `${value.type_id}@${value.bundle_version}`;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
