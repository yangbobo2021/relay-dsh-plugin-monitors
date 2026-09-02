import { newQuickJSWASMModule, shouldInterruptAfterDeadline } from "quickjs-emscripten";

const METHODS = new Set(["observe", "detect"]);

export class MonitorBundleSandbox {
  constructor({ wallClockMs = 100, memoryBytes = 8 * 1024 * 1024, stackBytes = 512 * 1024, outputBytes = 262_144 } = {}) {
    this.wallClockMs = positiveInteger(wallClockMs, 100);
    this.memoryBytes = positiveInteger(memoryBytes, 8 * 1024 * 1024);
    this.stackBytes = positiveInteger(stackBytes, 512 * 1024);
    this.outputBytes = positiveInteger(outputBytes, 262_144);
  }

  async validate(source) {
    const result = await this.#evaluate(source, "inspect", []);
    if (result?.observe !== "function" || result?.detect !== "function") {
      throw sandboxError("invalid_module", "Monitor Bundle must export monitor.observe() and monitor.detect()");
    }
    return Object.freeze({ valid: true, runtime: "quickjs-wasm", contract_version: 1 });
  }

  async observe(source, context) {
    return this.#evaluate(source, "observe", [boundedInput(context)]);
  }

  async detect(source, previous, current) {
    const result = await this.#evaluate(source, "detect", [boundedInput(previous), boundedInput(current)]);
    if (!Array.isArray(result)) throw sandboxError("invalid_output", "Monitor detect() must return an Event proposal array");
    return result;
  }

  async #evaluate(source, method, args) {
    if (typeof source !== "string" || !source.trim() || Buffer.byteLength(source, "utf8") > 65_536) {
      throw sandboxError("invalid_source", "Monitor Bundle source must contain 1 to 65536 UTF-8 bytes");
    }
    if (method !== "inspect" && !METHODS.has(method)) throw sandboxError("invalid_method", "Monitor Bundle method is invalid");
    const module = await newQuickJSWASMModule();
    const input = args.map(value => JSON.stringify(value)).join(",");
    const invocation = method === "inspect"
      ? `({ observe: typeof globalThis.monitor?.observe, detect: typeof globalThis.monitor?.detect })`
      : `globalThis.monitor.${method}(${input})`;
    const code = `${sandboxPrelude()}\n${source}\n;${invocation}`;
    let result;
    try {
      result = module.evalCode(code, {
        memoryLimitBytes: this.memoryBytes,
        maxStackSizeBytes: this.stackBytes,
        shouldInterrupt: shouldInterruptAfterDeadline(Date.now() + this.wallClockMs),
      });
    } catch (error) {
      const interrupted = /interrupted|out of memory|stack overflow/iu.test(String(error?.message ?? error));
      throw sandboxError(interrupted ? "resource_limit" : "execution_failed",
        interrupted ? "Monitor Bundle exceeded its execution budget" : "Monitor Bundle execution failed");
    }
    validateSandboxOutput(result, this.outputBytes);
    return result;
  }
}

export function validateSandboxOutput(value, maxBytes = 262_144) {
  let encoded;
  try { encoded = JSON.stringify(value); }
  catch { throw sandboxError("invalid_output", "Monitor Bundle output must be JSON serializable"); }
  if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > maxBytes) {
    throw sandboxError("output_limit", "Monitor Bundle output exceeded its byte budget");
  }
  return value;
}

function sandboxPrelude() {
  return `"use strict";
for (const name of ["Date", "performance", "process", "require", "fetch", "XMLHttpRequest", "WebSocket", "WebAssembly", "Atomics", "SharedArrayBuffer", "setTimeout", "setInterval", "queueMicrotask"]) {
  Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false });
}
Object.defineProperty(Math, "random", { value: undefined, writable: false, configurable: false });`;
}

function boundedInput(value) {
  validateSandboxOutput(value, 262_144);
  return structuredClone(value);
}

function sandboxError(errorClass, message) {
  return Object.assign(new Error(message), { name: "MonitorSandboxError", errorClass });
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
