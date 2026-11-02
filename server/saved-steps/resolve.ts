import { setTimeout as delay } from "node:timers/promises";
import { treeDegraded, wholeTree } from "./driver-wire.ts";
import { isRecord, matchApp, matchElement, matchWindow, type Match } from "./match.ts";

export { matchApp, matchElement, matchWindow, type Match };
import { KEY_TOOLS, holdsTypedText, type AppIdentity, type RecipeStep } from "./rules.ts";

/** `gate`: the computer's control gate refused the call (a person holds it, another turn has it): the step was not tried. */
export type CallOutcome = { ok: true; structured: Record<string, unknown> } | { ok: false; error: string; gate?: true };
export interface ComputerCaller { call(tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallOutcome> }
type Resolved = { ok: true; args: Record<string, unknown> } | (Extract<CallOutcome, { ok: false }> & { missing?: true });
export interface Patience { now(): number; sleep(ms: number, signal: AbortSignal): Promise<void> }

function heldValue(elements: unknown, index: number): string | undefined {
  const live = Array.isArray(elements) ? elements.find((item) => isRecord(item) && item.element_index === index) : undefined;
  return isRecord(live) && typeof live.value === "string" ? live.value : undefined;
}

const appName = (app: AppIdentity) => app.name || app.bundleId || "the app";
const fail = (error: string): Resolved => ({ ok: false, error });
const missing = (error: string): Resolved => ({ ok: false, error, missing: true });

export const RETRY_MS = 3_000;
export const POLL_MS = 250;
const REAL_TIME: Patience = { now: Date.now, sleep: (ms, signal) => delay(ms, undefined, { signal }).catch(() => {}) };

export async function resolveStepSoon(step: RecipeStep, caller: ComputerCaller, signal: AbortSignal, patience: Patience = REAL_TIME): Promise<Resolved> {
  const deadline = patience.now() + RETRY_MS;
  for (;;) {
    const target = await resolveStep(step, caller, signal);
    if (target.ok || !target.missing || signal.aborted || patience.now() + POLL_MS > deadline) return target;
    await patience.sleep(POLL_MS, signal);
  }
}

export async function resolveStep(step: RecipeStep, caller: ComputerCaller, signal: AbortSignal): Promise<Resolved> {
  const { app, window, element } = step;
  if (step.tool === "launch_app") return { ok: true, args: step.args };
  if (!app) return fail("the saved step does not name its app");
  if ((element || KEY_TOOLS.has(step.tool)) && !window) return fail("the saved step does not name its window");
  const name = appName(app);

  const apps = await caller.call("list_apps", {}, signal);
  if (!apps.ok) return apps;
  const pid = matchApp(apps.structured.apps, app);
  if (!pid.ok) return pid.reason === "none" ? missing(`${name} is not running`) : fail(`more than one ${name} app is running`);
  const args: Record<string, unknown> = { ...step.args, pid: pid.value };
  if (!window) return { ok: true, args };

  const windows = await caller.call("list_windows", { pid: pid.value, on_screen_only: false }, signal);
  if (!windows.ok) return windows;
  const windowId = matchWindow(windows.structured.windows, pid.value, window);
  if (!windowId.ok) return windowId.reason === "none" ? missing(`no window titled "${window.title}"`) : fail(`more than one window titled "${window.title}"`);
  args.window_id = windowId.value;
  if (!element) return { ok: true, args };

  const state = await caller.call("get_window_state", { pid: pid.value, window_id: windowId.value, include_screenshot: false }, signal);
  if (!state.ok) return state;
  const tree = state.structured;
  if (tree.pid !== pid.value || tree.window_id !== windowId.value) return fail("the computer answered for a different window");
  if (treeDegraded(tree)) return fail(`${window.title} could not be read reliably`);
  if (!wholeTree(tree)) return fail(`only part of ${window.title} could be read`);
  const found = matchElement(tree.elements, element);
  const target = `"${element.label}" (${element.role}) in ${window.title}`;
  if (!found.ok) return found.reason === "none" ? missing(`no ${target}`) : fail(`more than one ${target}`);
  const { element_token: token, element_index: index } = found.value;
  // Safety invariant: set_value replaces what a field holds, and a repeat never replaces someone's text.
  if (step.tool === "set_value" && holdsTypedText(element.role)) {
    const held = heldValue(tree.elements, index);
    if (held === undefined) return fail(`could not read what ${target} holds`);
    if (held !== "" && held !== step.args.value) return fail(`${target} already holds other text`);
  }
  return { ok: true, args: token === undefined ? { ...args, element_index: index } : { ...args, element_token: token } };
}
