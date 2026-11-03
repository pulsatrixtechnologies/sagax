// task_list (agents-task-tools.ts) carried to the internal route.
import type { ToolCallContext, ToolCallResult } from "./agents-call-types.ts";
import type { Json } from "./agents-client.ts";

export { TASK_LIST_TOOL_NAMES } from "./agents-task-tools.ts";

export async function callTaskListTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  if (context.externalRuntime) return { text: `Unknown tool: ${name}`, isError: true };
  const record = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  const { ok, body } = await context.client.apiResponse("/api/internal/task-list", {
    method: "POST",
    body: JSON.stringify(record),
  });
  if (!ok) return { text: String(body.error ?? "The task list could not be changed."), isError: true };
  if (record.action === "list") return { text: JSON.stringify(body.tasks ?? []) };
  // the state the server holds now, so the bot never reports one it did not set
  const task = body.task as { id?: unknown; state?: unknown; title?: unknown; note?: unknown } | undefined;
  const note = typeof task?.note === "string" && task.note ? ` Note: ${task.note}` : "";
  return { text: `Task ${String(task?.id ?? "")} is now ${String(task?.state ?? "")} on the server: ${String(task?.title ?? "")}.${note}` };
}
