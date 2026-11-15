// The working line's step for a tool call that just started
// (shared/working-step.ts), with its detail passed through the server's
// secret redaction before it rides on the activity row: a detail is only a
// file, app, host or program name, but a token pasted where a file name
// should be must still never reach a client.
import { workingStepFor, type WorkingStep, type WorkingStepCall } from "../shared/working-step.ts";
import { redactSecretsInText } from "./redact.ts";

/** #4394: the host each conversation's built-in browser last went to, so a
 * click or a read (which names no address) reads on that page. */
const pageHosts = new Map<string, string>();
const PAGE_HOSTS_KEPT = 1_000;

function builtInBrowserStep(name: string): boolean {
  return name.includes("agent_browser_");
}

export function toolWorkingStep(call: WorkingStepCall, threadId?: string): WorkingStep | undefined {
  const browser = threadId !== undefined && builtInBrowserStep(call.name);
  const known = browser ? pageHosts.get(threadId) : undefined;
  const step = workingStepFor(known && call.pageHost === undefined ? { ...call, pageHost: known } : call);
  if (!step) return undefined;
  if (step.detail === undefined) return step;
  const detail = redactSecretsInText(step.detail);
  // anything the redaction touched is dropped, not shown half masked
  if (detail !== step.detail) return { key: step.key };
  if (browser && step.key === "browse" && step.detail !== known) {
    pageHosts.delete(threadId);
    pageHosts.set(threadId, step.detail);
    if (pageHosts.size > PAGE_HOSTS_KEPT) pageHosts.delete(pageHosts.keys().next().value!);
  }
  return step;
}
