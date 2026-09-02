import { defineTool } from "@deepseek-ai/dsh-tools";

export function installMonitorAgentBridge(ctx, { sessionId, scheduleTimer, listBundleTypes }) {
  const disposers = [];
  disposers.push(ctx.tools.register(defineTool({
    name: "relay_schedule_timer",
    description: "Continue this conversation after a durable positive delay.",
    parameters: {
      task_summary: { type: "string", required: true },
      after_seconds: { type: "integer" },
      deadline: { type: "string" },
      allow_immediate: { type: "boolean" },
      resume_prompt: { type: "string", required: true },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          scheduled: { type: "boolean", required: true },
          sessionId: { type: "string", required: true },
          timerId: { type: "string", required: true },
          dueAt: { type: "string", required: true },
        },
      },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    async execute(args) {
      const timer = await scheduleTimer({
        sessionId,
        taskSummary: args.task_summary,
        afterSeconds: args.after_seconds,
        deadline: args.deadline,
        allowImmediate: args.allow_immediate ?? false,
        resumePrompt: args.resume_prompt,
      });
      return { scheduled: true, sessionId, timerId: timer.timer_id, dueAt: timer.deadline };
    },
  })));
  if (listBundleTypes) {
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
  }
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
