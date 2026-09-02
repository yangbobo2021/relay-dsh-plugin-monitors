import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export class TimerObserver {
  constructor({ clock = () => new Date() } = {}) {
    this.clock = clock;
  }

  async observe() {
    return { observed_at: this.clock().toISOString() };
  }
}

export function createTimerWait({
  sessionId,
  afterSeconds,
  deadline: absoluteDeadline,
  allowImmediate = false,
  resumePrompt,
  taskSummary = resumePrompt,
  now = new Date(),
  idFactory = randomUUID,
}) {
  assert.equal(typeof sessionId, "string", "timer sessionId is required");
  assert.notEqual(afterSeconds != null, absoluteDeadline != null, "provide exactly one of afterSeconds or deadline");
  assert.equal(typeof resumePrompt, "string", "timer resumePrompt is required");
  assert.ok(resumePrompt.trim().length > 0, "timer resumePrompt cannot be empty");
  assert.equal(typeof taskSummary, "string", "timer taskSummary is required");
  assert.ok(taskSummary.trim().length > 0, "timer taskSummary cannot be empty");
  assert.ok(now instanceof Date && Number.isFinite(now.getTime()), "timer now must be a valid Date");

  assert.equal(typeof allowImmediate, "boolean", "allowImmediate must be boolean");
  const resolved = resolveDeadline({ afterSeconds, absoluteDeadline, now, allowImmediate });
  const timerId = `timer-${idFactory()}`;
  const waitId = `wait-${timerId}`;
  const deadline = resolved.deadline;
  return {
    sessionId,
    taskSummary: taskSummary.trim(),
    context: { timer_id: timerId, deadline, deadline_intent: resolved.intent, resume_prompt: resumePrompt.trim() },
    waits: [{
      wait_id: waitId,
      phase: "waiting_for_time",
      exclusive: true,
      exclusive_owner_key: timerId,
      expected_event: "timer.elapsed",
      caused_by: "The Agent delegated a future continuation to Relay.",
      actors: [],
      entities: [timerId],
      prior_exchange: resumePrompt.trim(),
      continuation: {
        next_action: resumePrompt.trim(),
        success_condition: "The requested Relay deadline has elapsed.",
        constraints: [],
        artifacts: [{ kind: "relay_timer", id: timerId, label: deadline }],
        on_failure: "Report that the durable timer failed.",
        on_timeout: resumePrompt.trim(),
      },
    }],
    monitors: [{
      monitor_id: timerId,
      wait_id: waitId,
      lifecycle: "one_shot",
      detector: {
        kind: "deadline_reached",
        timer_id: timerId,
        deadline,
        event_type: "timer.elapsed",
        resume_prompt: resumePrompt.trim(),
      },
      observer: { provider: "clock" },
      schedule: { interval_seconds: resolved.intervalSeconds, jitter_seconds: 0 },
      capabilities: { clock: true },
      artifact: { kind: "builtin", name: "relay.timer" },
    }],
    timer: { timer_id: timerId, wait_id: waitId, deadline, intent: resolved.intent },
  };
}

function resolveDeadline({ afterSeconds, absoluteDeadline, now, allowImmediate }) {
  if (afterSeconds != null) {
    assert.ok(Number.isSafeInteger(afterSeconds) && afterSeconds > 0, "afterSeconds must be a positive safe integer");
    const timestamp = now.getTime() + afterSeconds * 1000;
    assert.ok(Number.isFinite(timestamp) && timestamp <= 8_640_000_000_000_000, "afterSeconds must be a positive safe integer within the Date range");
    return {
      deadline: new Date(timestamp).toISOString(),
      intervalSeconds: afterSeconds,
      intent: { kind: "relative", after_seconds: afterSeconds },
    };
  }
  assert.equal(typeof absoluteDeadline, "string", "deadline must be an RFC3339 string with an explicit timezone");
  const parts = absoluteDeadline.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/u);
  assert.ok(parts, "deadline must be an RFC3339 string with an explicit timezone");
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, zoneHourText, zoneMinuteText] = parts;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  assert.ok(month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate(), "deadline must be a valid RFC3339 timestamp");
  assert.ok(Number(hourText) <= 23 && Number(minuteText) <= 59 && Number(secondText) <= 59, "deadline must be a valid RFC3339 timestamp");
  if (zone !== "Z") assert.ok(Number(zoneHourText) <= 23 && Number(zoneMinuteText) <= 59, "deadline must have a valid timezone offset");
  const timestamp = Date.parse(absoluteDeadline);
  assert.ok(Number.isFinite(timestamp), "deadline must be a valid RFC3339 timestamp");
  assert.ok(timestamp > now.getTime() || allowImmediate, "deadline must be in the future unless allowImmediate is true");
  const dueTimestamp = timestamp <= now.getTime() ? now.getTime() : timestamp;
  const intervalSeconds = Math.max(1, Math.ceil((dueTimestamp - now.getTime()) / 1000));
  return {
    deadline: new Date(dueTimestamp).toISOString(),
    intervalSeconds,
    intent: { kind: "absolute", input: absoluteDeadline, immediate: timestamp <= now.getTime() },
  };
}
