import { defineTool } from "@deepseek-ai/dsh-tools";

export function installMonitorAgentBridge(ctx, { sessionId, listBundleTypes }) {
  if (!sessionId) throw new Error("Relay Monitor bridge requires the current DSH session id");
  if (typeof listBundleTypes !== "function") throw new Error("listBundleTypes callback is required");
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
          authorization: { sessionId },
        });
        return { bundleTypes };
      },
  })));
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
