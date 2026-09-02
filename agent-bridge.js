import { defineTool } from "@deepseek-ai/dsh-tools";

export function installMonitorAgentBridge(ctx, {
  sessionId, authorization = {}, listBundleTypes, createBundleFromType, validateCustomBundle, installCustomBundle,
  updateCustomBundle, rollbackCustomBundle,
}) {
  if (!sessionId) throw new Error("Relay Monitor bridge requires the current DSH session id");
  if (typeof listBundleTypes !== "function") throw new Error("listBundleTypes callback is required");
  if (typeof createBundleFromType !== "function") throw new Error("createBundleFromType callback is required");
  if (typeof validateCustomBundle !== "function") throw new Error("validateCustomBundle callback is required");
  if (typeof installCustomBundle !== "function") throw new Error("installCustomBundle callback is required");
  if (typeof updateCustomBundle !== "function") throw new Error("updateCustomBundle callback is required");
  if (typeof rollbackCustomBundle !== "function") throw new Error("rollbackCustomBundle callback is required");
  const disposers = [];
  disposers.push(ctx.tools.register(defineTool({
      name: "relay_list_monitor_bundle_types",
      description: "List Monitor Bundle Types currently available to this conversation and project.",
      parameters: {
        locale: { type: "string", enum: ["en-US", "zh-CN"] },
        cursor: { type: "string" },
        limit: { type: "integer", description: "Page size from 1 to 100; defaults to 50." },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            bundleTypes: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
            nextCursor: { type: "string" },
            total: { type: "integer", required: true },
          },
        },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
      },
      async execute(args) {
        const page = await listBundleTypes({
          locale: args.locale ?? "en-US",
          cursor: args.cursor ?? null,
          limit: args.limit ?? 50,
          authorization: { ...authorization, sessionId },
        });
        return {
          bundleTypes: page.bundleTypes,
          total: page.total,
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        };
      },
  })));
  disposers.push(ctx.tools.register(defineTool({
    name: "relay_update_monitor_bundle",
    description: "Atomically update one owned custom Monitor from a new validation receipt while retaining version history.",
    parameters: {
      monitor_id: { type: "string", required: true },
      validation_id: { type: "string", required: true },
      expected_version: { type: "integer" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          updated: { type: "boolean", required: true },
          monitorId: { type: "string", required: true },
          validationId: { type: "string", required: true },
          artifactHash: { type: "string", required: true },
          previousVersionId: { type: "string", required: true },
          activeVersionId: { type: "string", required: true },
          version: { type: "integer", required: true },
        },
      },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    async execute(args) {
      const result = await updateCustomBundle({
        monitorId: args.monitor_id,
        validationId: args.validation_id,
        sessionId,
        authorization: { ...authorization, sessionId },
        ...(args.expected_version === undefined ? {} : { expectedVersion: args.expected_version }),
      });
      return { updated: true, ...result };
    },
  })));
  disposers.push(ctx.tools.register(defineTool({
    name: "relay_rollback_monitor_bundle",
    description: "Atomically roll one owned custom Monitor back to a retained version without expanding capabilities.",
    parameters: {
      monitor_id: { type: "string", required: true },
      version_id: { type: "string", required: true },
      expected_version: { type: "integer" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          rolledBack: { type: "boolean", required: true },
          monitorId: { type: "string", required: true },
          artifactHash: { type: "string", required: true },
          previousVersionId: { type: "string", required: true },
          activeVersionId: { type: "string", required: true },
          version: { type: "integer", required: true },
        },
      },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    async execute(args) {
      const result = await rollbackCustomBundle({
        monitorId: args.monitor_id,
        versionId: args.version_id,
        sessionId,
        authorization: { ...authorization, sessionId },
        ...(args.expected_version === undefined ? {} : { expectedVersion: args.expected_version }),
      });
      return { rolledBack: true, ...result };
    },
  })));
  disposers.push(ctx.tools.register(defineTool({
    name: "relay_validate_monitor_bundle",
    description: "Validate and copy a Session-scoped custom Monitor Bundle into Relay-owned immutable storage.",
    parameters: {
      manifest: { type: "object", required: true, additionalProperties: true, properties: {} },
      source: { type: "string", required: true },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          validated: { type: "boolean", required: true },
          validationId: { type: "string", required: true },
          artifactHash: { type: "string", required: true },
          artifactBytes: { type: "integer", required: true },
          typeId: { type: "string", required: true },
          approvedCapabilities: { type: "array", required: true, items: { type: "string" } },
          receiptExpiresAt: { type: "string", required: true },
          bundleExpiresAt: { type: "string", required: true },
          runtime: { type: "string", required: true },
        },
      },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    async execute(args) {
      const result = await validateCustomBundle({
        manifest: args.manifest,
        source: args.source,
        authorization: { ...authorization, sessionId },
      });
      return { validated: true, ...result };
    },
  })));
  disposers.push(ctx.tools.register(defineTool({
    name: "relay_install_monitor_bundle",
    description: "Install exactly one previously validated custom Monitor Bundle for this conversation.",
    parameters: {
      validation_id: { type: "string", required: true },
      task_summary: { type: "string", required: true },
      resume_prompt: { type: "string", required: true },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          installed: { type: "boolean", required: true },
          sessionId: { type: "string", required: true },
          validationId: { type: "string", required: true },
          artifactHash: { type: "string", required: true },
          monitorIds: { type: "array", required: true, items: { type: "string" } },
          waitIds: { type: "array", required: true, items: { type: "string" } },
          nextCheckAt: { type: "string" },
          expiry: { type: "string", required: true },
        },
      },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    async execute(args) {
      const result = await installCustomBundle({
        validationId: args.validation_id,
        sessionId,
        authorization: { ...authorization, sessionId },
        taskSummary: args.task_summary,
        resumePrompt: args.resume_prompt,
      });
      return { installed: true, sessionId, ...result };
    },
  })));
  disposers.push(ctx.tools.register(defineTool({
    name: "relay_create_monitor_from_type",
    description: "Create a durable Monitor from one available registered Bundle Type for this conversation.",
    parameters: {
      type_id: { type: "string", required: true },
      bundle_version: { type: "integer", required: true },
      task_summary: { type: "string", required: true },
      parameters: { type: "object", required: true, additionalProperties: true, properties: {} },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          created: { type: "boolean", required: true },
          sessionId: { type: "string", required: true },
          typeId: { type: "string", required: true },
          bundleVersion: { type: "integer", required: true },
          monitorIds: { type: "array", required: true, items: { type: "string" } },
          waitIds: { type: "array", required: true, items: { type: "string" } },
          nextCheckAt: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    async execute(args) {
      const result = await createBundleFromType({
        typeId: args.type_id,
        bundleVersion: args.bundle_version,
        taskSummary: args.task_summary,
        parameters: args.parameters,
        sessionId,
        authorization: { ...authorization, sessionId },
      });
      return {
        created: true,
        sessionId,
        typeId: args.type_id,
        bundleVersion: args.bundle_version,
        monitorIds: result.monitorIds,
        waitIds: result.waitIds,
        ...(result.nextCheckAt ? { nextCheckAt: result.nextCheckAt } : {}),
      };
    },
  })));
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
