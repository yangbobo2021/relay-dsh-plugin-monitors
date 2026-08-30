import { defineTool } from "@deepseek-ai/dsh-tools";

export function installMonitorAgentBridge(ctx, { sessionId, scheduleTimer }) {
  return ctx.tools.register(defineTool({
    name: "relay_schedule_timer",
    description: "Continue this conversation after a durable positive delay.",
    parameters: {
      task_summary: { type: "string", required: true },
      after_seconds: { type: "integer", required: true },
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
        resumePrompt: args.resume_prompt,
      });
      return { scheduled: true, sessionId, timerId: timer.timer_id, dueAt: timer.deadline };
    },
  }));
}
