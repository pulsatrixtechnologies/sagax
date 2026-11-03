// What a bot may do to the Local VM's own desktop, checked before the call
// leaves the server. The desktop checks again (electron/local-vm-computer.mjs).
// The packaged app only ships electron/, and this image only ships
// dist-server, so the two copies stay apart. server/computer/local-vm-computer.test.ts
// runs one list of calls through both and fails when they disagree.
//
// A tool or an argument that is not listed is refused. Screenshots come back
// inline. A path, a shell line and the person's own screen are not in this list.

const NUMBER = { type: "number", min: 0, max: 10000 } as const;
const BUTTON = { type: "enum", values: ["left", "right", "middle"] } as const;
const XY = { x: NUMBER, y: NUMBER };
const KEY = { type: "string", max: 40, reject: /[\0\r\n/\\]/ } as const;

type Spec =
  | { type: "integer"; min: number; max: number }
  | { type: "number"; min: number; max: number }
  | { type: "enum"; values: readonly string[] }
  | { type: "string"; max: number; reject?: RegExp }
  | { type: "strings"; max: number; values: readonly string[] };

export const LOCAL_VM_COMPUTER_ARGUMENTS: Record<string, Record<string, Spec>> = Object.freeze({
  screenshot: {},
  get_desktop_state: {},
  get_screen_size: {},
  list_apps: {},
  click: { ...XY, button: BUTTON, count: { type: "integer", min: 1, max: 3 } },
  move_cursor: { ...XY },
  drag: {
    from_x: NUMBER, from_y: NUMBER, to_x: NUMBER, to_y: NUMBER, button: BUTTON,
    duration_ms: { type: "integer", min: 0, max: 10000 },
    steps: { type: "integer", min: 1, max: 200 },
  },
  type_text: { text: { type: "string", max: 20000 }, delay_ms: { type: "integer", min: 0, max: 200 } },
  press_key: { key: KEY, modifiers: { type: "strings", max: 6, values: ["shift", "control", "ctrl", "alt", "super", "meta"] } },
  scroll: {
    ...XY,
    direction: { type: "enum", values: ["up", "down", "left", "right"] },
    amount: { type: "integer", min: 1, max: 50 },
    by: { type: "enum", values: ["line", "page"] },
  },
});

const REQUIRED: Record<string, readonly string[]> = Object.freeze({
  click: ["x", "y"],
  move_cursor: ["x", "y"],
  drag: ["from_x", "from_y", "to_x", "to_y"],
  type_text: ["text"],
  press_key: ["key"],
  scroll: ["direction"],
});

const DESCRIPTIONS: Record<string, string> = Object.freeze({
  screenshot: "See the Local VM desktop. Returns a PNG of the screen. Same screen as get_desktop_state.",
  get_desktop_state: "See the Local VM desktop. Returns a PNG of the screen.",
  get_screen_size: "Width and height of the Local VM screen, in pixels.",
  list_apps: "List the apps running in the Local VM.",
  click: "Click the Local VM screen at x, y. button is left, right or middle. count is 1, 2 or 3.",
  move_cursor: "Move the pointer on the Local VM screen to x, y.",
  drag: "Drag on the Local VM screen from from_x, from_y to to_x, to_y.",
  type_text: "Type text into the Local VM, at the focused place.",
  press_key: "Press one key in the Local VM. modifiers is a list of shift, control, ctrl, alt, super or meta.",
  scroll: "Scroll the Local VM screen. direction is up, down, left or right.",
});

function property(spec: Spec): Record<string, unknown> {
  switch (spec.type) {
    case "integer": return { type: "integer", minimum: spec.min, maximum: spec.max };
    case "number": return { type: "number", minimum: spec.min, maximum: spec.max };
    case "enum": return { type: "string", enum: [...spec.values] };
    case "string": return { type: "string", maxLength: spec.max };
    case "strings": return { type: "array", maxItems: spec.max, items: { type: "string", enum: [...spec.values] } };
  }
}

function acceptable(spec: Spec, value: unknown): boolean {
  switch (spec.type) {
    case "string":
      return typeof value === "string" && value.length <= spec.max && !value.includes("\0") && !(spec.reject && spec.reject.test(value));
    case "integer":
    case "number": {
      if (typeof value !== "number" || !(spec.type === "integer" ? Number.isSafeInteger(value) : Number.isFinite(value))) return false;
      return value >= spec.min && value <= spec.max;
    }
    case "enum":
      return (spec.values as readonly unknown[]).includes(value);
    case "strings":
      return Array.isArray(value) && value.length <= spec.max && value.every(entry => typeof entry === "string" && (spec.values as readonly string[]).includes(entry));
  }
}

export interface LocalVmComputerTool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
}

/** The screen tools, for the model. No desktop round trip. */
export function localVmComputerCatalog(): LocalVmComputerTool[] {
  return Object.keys(LOCAL_VM_COMPUTER_ARGUMENTS).map(name => {
    const allowed = LOCAL_VM_COMPUTER_ARGUMENTS[name] ?? {};
    const properties = Object.fromEntries(Object.entries(allowed).map(([key, spec]) => [key, property(spec)]));
    const required = REQUIRED[name] ?? [];
    return {
      name,
      description: DESCRIPTIONS[name] ?? name,
      inputSchema: { type: "object", properties, ...(required.length ? { required: [...required] } : {}), additionalProperties: false },
    };
  });
}

export function localVmComputerCatalogText(): string {
  return JSON.stringify(localVmComputerCatalog());
}

export type LocalVmComputerCall =
  | { tool: string; arguments: Record<string, unknown>; image: boolean }
  | { error: string };

/**
 * One screen call, or an error. `tool` is the cua-driver name (screenshot
 * is get_desktop_state). `image` means the desktop returns the PNG itself
 * and ignores any path. The arguments are a fresh object.
 */
export function localVmComputerCall(name: unknown, input: unknown): LocalVmComputerCall {
  const label = typeof name === "string" && name ? name.slice(0, 100) : "that tool";
  if (typeof name !== "string" || !Object.hasOwn(LOCAL_VM_COMPUTER_ARGUMENTS, name)) return { error: `${label} is not part of the Local VM screen` };
  const allowed = LOCAL_VM_COMPUTER_ARGUMENTS[name] ?? {};
  const given = input ?? {};
  if (typeof given !== "object" || Array.isArray(given)) return { error: "Tool arguments must be an object" };
  const record = given as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length > 20) return { error: `${label}: too many arguments` };
  const forwarded: Record<string, unknown> = {};
  for (const key of keys) {
    if (!Object.hasOwn(allowed, key)) return { error: `${label}: ${key.slice(0, 100)} is not allowed on the Local VM screen` };
    const spec = allowed[key];
    if (!spec || !acceptable(spec, record[key])) return { error: `${label}: ${key} has a value the Local VM screen does not accept` };
    forwarded[key] = spec.type === "strings" ? [...(record[key] as unknown[])] : record[key];
  }
  for (const key of REQUIRED[name] ?? []) {
    if (!Object.hasOwn(forwarded, key)) return { error: `${label}: ${key} is required` };
  }
  return { tool: name === "screenshot" ? "get_desktop_state" : name, arguments: forwarded, image: name === "screenshot" || name === "get_desktop_state" };
}
