const SCHEMA_KEYS = new Set([
  "type", "enum", "const", "oneOf", "anyOf", "allOf", "not",
  "properties", "required", "additionalProperties", "minProperties", "maxProperties",
  "items", "minItems", "maxItems", "uniqueItems",
  "minLength", "maxLength", "pattern",
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "description", "title", "default",
]);
const TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);

export function assertValidParameterSchema(schema, path = "parameter schema") {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new TypeError(`${path} must be an object`);
  for (const key of Object.keys(schema)) if (!SCHEMA_KEYS.has(key)) throw new TypeError(`${path} uses unsupported keyword ${key}`);
  if (schema.type !== undefined && !TYPES.has(schema.type)) throw new TypeError(`${path}.type is invalid`);
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) throw new TypeError(`${path}.enum must be non-empty`);
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== "string" || schema.pattern.length > 1_000) throw new TypeError(`${path}.pattern is invalid`);
    try { new RegExp(schema.pattern, "u"); } catch { throw new TypeError(`${path}.pattern is invalid`); }
  }
  for (const key of ["minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties"]) {
    if (schema[key] !== undefined && (!Number.isSafeInteger(schema[key]) || schema[key] < 0)) throw new TypeError(`${path}.${key} is invalid`);
  }
  for (const key of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"]) {
    if (schema[key] !== undefined && (!Number.isFinite(schema[key]) || (key === "multipleOf" && schema[key] <= 0))) {
      throw new TypeError(`${path}.${key} is invalid`);
    }
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some(item => typeof item !== "string")
      || new Set(schema.required).size !== schema.required.length) throw new TypeError(`${path}.required is invalid`);
  }
  if (schema.properties !== undefined) {
    if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) throw new TypeError(`${path}.properties is invalid`);
    for (const [key, value] of Object.entries(schema.properties)) assertValidParameterSchema(value, `${path}.properties.${key}`);
  }
  if (schema.items !== undefined) assertValidParameterSchema(schema.items, `${path}.items`);
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") {
    assertValidParameterSchema(schema.additionalProperties, `${path}.additionalProperties`);
  }
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    if (schema[key] !== undefined) {
      if (!Array.isArray(schema[key]) || schema[key].length === 0 || schema[key].length > 32) throw new TypeError(`${path}.${key} is invalid`);
      schema[key].forEach((value, index) => assertValidParameterSchema(value, `${path}.${key}[${index}]`));
    }
  }
  if (schema.not !== undefined) assertValidParameterSchema(schema.not, `${path}.not`);
  return schema;
}

export function validateParameters(schema, value) {
  const seen = new Set();
  const violations = validate(schema, value, "$", seen);
  if (violations.length) throw new TypeError(`monitor Bundle parameter ${violations[0]}`);
  return value;
}

function validate(schema, value, path, seen) {
  const errors = [];
  if (value && typeof value === "object") {
    if (seen.has(value)) return [`${path} must not contain a cycle`];
    seen.add(value);
  }
  if (schema.type && !matchesType(schema.type, value)) errors.push(`${path} must be ${schema.type}`);
  if (schema.enum && !schema.enum.some(candidate => deepEqual(candidate, value))) errors.push(`${path} must match enum`);
  if ("const" in schema && !deepEqual(schema.const, value)) errors.push(`${path} must match const`);
  if (typeof value === "string") {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) errors.push(`${path} is shorter than minLength`);
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) errors.push(`${path} is longer than maxLength`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${path} does not match pattern`);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) errors.push(`${path} must be finite`);
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} is below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} is above maximum`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${path} is below exclusiveMinimum`);
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) errors.push(`${path} is above exclusiveMaximum`);
    if (schema.multipleOf !== undefined && Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > Number.EPSILON) errors.push(`${path} is not a multipleOf value`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} has too few items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} has too many items`);
    if (schema.uniqueItems && new Set(value.map(stableJson)).size !== value.length) errors.push(`${path} must contain unique items`);
    if (schema.items) value.forEach((item, index) => errors.push(...validate(schema.items, item, `${path}[${index}]`, seen)));
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) errors.push(`${path} has too few properties`);
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) errors.push(`${path} has too many properties`);
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}.${key} is required`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...validate(schema.properties[key], item, `${path}.${key}`, seen));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key} is not allowed`);
      else if (isObject(schema.additionalProperties)) errors.push(...validate(schema.additionalProperties, item, `${path}.${key}`, seen));
    }
  }
  for (const key of ["allOf"]) for (const child of schema[key] ?? []) errors.push(...validate(child, value, path, new Set()));
  if (schema.anyOf && !schema.anyOf.some(child => validate(child, value, path, new Set()).length === 0)) errors.push(`${path} must match anyOf`);
  if (schema.oneOf && schema.oneOf.filter(child => validate(child, value, path, new Set()).length === 0).length !== 1) errors.push(`${path} must match exactly one oneOf branch`);
  if (schema.not && validate(schema.not, value, path, new Set()).length === 0) errors.push(`${path} must not match forbidden schema`);
  if (value && typeof value === "object") seen.delete(value);
  return errors;
}

function matchesType(type, value) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isObject(value);
  if (type === "integer") return Number.isSafeInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function deepEqual(left, right) {
  return stableJson(left) === stableJson(right);
}
