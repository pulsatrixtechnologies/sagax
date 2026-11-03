// What a bot may do to the Local VM's own desktop. The desktop app is the
// trust boundary: a tool or an argument that is not listed here is refused,
// never forwarded. Screenshots come back inline. A path, a shell line and
// the person's own screen are not in this list.
//
// The same rules are copied in server/computer/local-vm-computer.ts. The packaged
// app only ships electron/, and the server image only ships dist-server, so
// neither side can import the other. server/computer/local-vm-computer.test.ts runs
// one list of calls through both and fails when they disagree.

const NUMBER = { type: "number", min: 0, max: 10000 };
const BUTTON = { type: "enum", values: ["left", "right", "middle"] };
const XY = { x: NUMBER, y: NUMBER };
const KEY = { type: "string", max: 40, reject: /[\0\r\n/\\]/ };

export const LOCAL_VM_COMPUTER_ARGUMENTS = Object.freeze({
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

const REQUIRED = Object.freeze({
  click: ["x", "y"],
  move_cursor: ["x", "y"],
  drag: ["from_x", "from_y", "to_x", "to_y"],
  type_text: ["text"],
  press_key: ["key"],
  scroll: ["direction"],
});

const DESCRIPTIONS = Object.freeze({
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

function property(spec) {
  switch (spec.type) {
    case "integer": return { type: "integer", minimum: spec.min, maximum: spec.max };
    case "number": return { type: "number", minimum: spec.min, maximum: spec.max };
    case "enum": return { type: "string", enum: [...spec.values] };
    case "string": return { type: "string", maxLength: spec.max };
    case "strings": return { type: "array", maxItems: spec.max, items: { type: "string", enum: [...spec.values] } };
    default: return { type: "string" };
  }
}

function acceptable(spec, value) {
  switch (spec.type) {
    case "string":
      return typeof value === "string" && value.length <= spec.max && !value.includes("\0") && !(spec.reject && spec.reject.test(value));
    case "integer":
      return Number.isSafeInteger(value) && value >= spec.min && value <= spec.max;
    case "number":
      return typeof value === "number" && Number.isFinite(value) && value >= spec.min && value <= spec.max;
    case "enum":
      return spec.values.includes(value);
    case "strings":
      return Array.isArray(value) && value.length <= spec.max && value.every(entry => typeof entry === "string" && spec.values.includes(entry));
    default:
      return false;
  }
}

/** The screen tools, for the model. No desktop round trip. */
export function localVmComputerCatalog() {
  return Object.keys(LOCAL_VM_COMPUTER_ARGUMENTS).map(name => {
    const allowed = LOCAL_VM_COMPUTER_ARGUMENTS[name];
    const properties = Object.fromEntries(Object.entries(allowed).map(([key, spec]) => [key, property(spec)]));
    const required = REQUIRED[name] ?? [];
    return {
      name,
      description: DESCRIPTIONS[name],
      inputSchema: { type: "object", properties, ...(required.length ? { required: [...required] } : {}), additionalProperties: false },
    };
  });
}

export function localVmComputerCatalogText() {
  return JSON.stringify(localVmComputerCatalog());
}

/**
 * One screen call, or an error. `tool` is the cua-driver name (screenshot
 * is get_desktop_state). `image` means the desktop returns the PNG itself
 * and ignores any path. The arguments are a fresh object.
 */
export function localVmComputerCall(name, input) {
  const label = typeof name === "string" && name ? name.slice(0, 100) : "that tool";
  const allowed = typeof name === "string" && Object.hasOwn(LOCAL_VM_COMPUTER_ARGUMENTS, name) ? LOCAL_VM_COMPUTER_ARGUMENTS[name] : null;
  if (!allowed) return { error: `${label} is not part of the Local VM screen` };
  const given = input ?? {};
  if (typeof given !== "object" || Array.isArray(given)) return { error: "Tool arguments must be an object" };
  const keys = Object.keys(given);
  if (keys.length > 20) return { error: `${label}: too many arguments` };
  const forwarded = {};
  for (const key of keys) {
    if (!Object.hasOwn(allowed, key)) return { error: `${label}: ${key.slice(0, 100)} is not allowed on the Local VM screen` };
    if (!acceptable(allowed[key], given[key])) return { error: `${label}: ${key} has a value the Local VM screen does not accept` };
    forwarded[key] = allowed[key].type === "strings" ? [...given[key]] : given[key];
  }
  for (const key of REQUIRED[name] ?? []) {
    if (!Object.hasOwn(forwarded, key)) return { error: `${label}: ${key} is required` };
  }
  return { tool: name === "screenshot" ? "get_desktop_state" : name, arguments: forwarded, image: name === "screenshot" || name === "get_desktop_state" };
}
