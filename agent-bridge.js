import { defineTool } from "@deepseek-ai/dsh-tools";

export function installMonitorAgentBridge(ctx, { sessionId, authorization = {}, listBundleTypes, createBundleFromType }) {
  if (!sessionId) throw new Error("Relay Monitor bridge requires the current DSH session id");
  if (typeof listBundleTypes !== "function") throw new Error("listBundleTypes callback is required");
  if (typeof createBundleFromType !== "function") throw new Error("createBundleFromType callback is required");
  const disposers = [];
  disposers.push(ctx.tools.register(defineTool({
      name: "relay_list_monitor_bundle_types",
      description: "List Monitor Bundle Types currently available to this conversation and project.",
      parameters: {
        locale: { type: "string", enum: ["en-US", "zh-CN"] },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            bundleTypes: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          },
        },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
      },
      async execute(args) {
        const bundleTypes = await listBundleTypes({
          locale: args.locale ?? "en-US",
          authorization: { ...authorization, sessionId },
        });
        return { bundleTypes };
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
