// 2026-10-21 (parité R10, ligne 80): "Toujours permettre" for one app of the
// person's own computer ("Cryptic peut voir Safari, y cliquer et y saisir du
// texte sur cet ordinateur"). A screen action names the app it acts on by a
// process id (cua-driver: click, type_text, scroll... take `pid`). This
// module only reads WHICH target a call names and whether an app rule may
// cover it at all; the app's identity (bundle id and signing team) comes
// from the server (server/computer-app.ts reads the pid on this computer),
// never from what the model wrote: a call that says `app: "Safari"` beside
// the pid of Terminal is Terminal.
//
// Review of #954: an app rule covers only input that lands in that app.
// Delivery in the foreground (it falls back to the frontmost app or the HID
// stream), a hotkey or a key with a modifier (global shortcuts), an
// argument that writes a file (`screenshot_out_file`, `debug_image_out`) or
// an unknown argument, and typing into an element the call picks by index
// or position are never covered: their card asks each time. Typing into the
// focused element is covered only once the server checked it is not a
// password field, and a `window_id` only once it checked the window belongs
// to that pid.
//
// Pure: shared by the server (rules) and the tests.

/** The screen tools an app rule may cover, with the arguments it accepts:
 * any other argument (a file to write, a newer driver's option) keeps the
 * card. launch_app is never here: its app and URLs are the model's words. */
const TARGET = ["pid", "window_id", "session"] as const;
const ELEMENT = ["element_index", "element_token"] as const;
const AT = ["x", "y"] as const;
const DELIVERY = ["delivery_mode"] as const;
const COVERABLE: Readonly<Record<string, readonly string[]>> = {
  click: [...TARGET, ...ELEMENT, ...AT, ...DELIVERY, "action", "button", "count", "from_zoom", "scope"],
  double_click: [...TARGET, ...ELEMENT, ...AT, ...DELIVERY],
  right_click: [...TARGET, ...ELEMENT, ...AT, ...DELIVERY],
  scroll: [...TARGET, ...ELEMENT, ...AT, ...DELIVERY, "amount", "by", "direction", "scope"],
  press_key: [...TARGET, ...ELEMENT, ...AT, ...DELIVERY, "key", "modifiers", "scope"],
  type_text: [...TARGET, ...ELEMENT, ...AT, ...DELIVERY, "delay_ms", "scope", "text"],
  set_value: [...TARGET, ...ELEMENT, "value"],
  bring_to_front: ["pid", "window_id"],
  get_window_state: [...TARGET, "capture_mode", "include_screenshot", "max_depth", "max_elements", "query"],
  zoom: ["pid", "window_id", "x1", "y1", "x2", "y2"],
};
/** Tools that type: covered only into the focused element, checked first. */
const TYPING: ReadonlySet<string> = new Set(["type_text", "set_value"]);
const SAFE_MODIFIERS: ReadonlySet<string> = new Set(["shift"]);
/** Keys an app rule covers in press_key: one printable character, or a
 * named key with no shortcut meaning by itself. Never a combo written in
 * the key itself ("cmd+q"). */
const SAFE_KEY = /^(?:[A-Za-z0-9 .,;:'"!?@#$%&*()[\]{}<>/\\_=-]|return|enter|tab|space|escape|esc|delete|backspace|forwarddelete|up|down|left|right|home|end|pageup|pagedown)$/i;

/** The local screen's own MCP server (server/drivers/chat-mcp-tools.ts mounts
 * the person's computer as "computer") and the desktop bridge's wrapper
 * (sagax-desktop computer_use). */
const DIRECT = /^(?:mcp__)?computer__([a-z_]{1,40})$/i;
const BRIDGE = /^(?:mcp__)?sagax-desktop__computer_use$/i;

export interface ScreenAppTarget {
  kind: "pid";
  pid: number;
  /** The window the call names: the server checks it is the pid's own. */
  windowId?: number;
  /** A typing call into the focused element: the server checks it is not
   * a password field. */
  focusCheck?: boolean;
}

/** What the server read of an app: its name on screen, its bundle id and
 * its signing team ("apple" for Apple's own apps). */
export interface ScreenAppIdentity {
  label: string;
  bundleId: string;
  team: string;
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parse(input: string | undefined): Record<string, unknown> | null {
  if (typeof input !== "string" || !input.trim()) return null;
  try {
    return objectOf(JSON.parse(input));
  } catch {
    return null;
  }
}

const APP_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._&'+-]{0,79}$/u;

/** The inner screen tool and its arguments, for either shape. */
export function screenCallOf(tool: string | undefined, input: string | undefined): { tool: string; args: Record<string, unknown> } | null {
  const name = (tool ?? "").trim();
  const args = parse(input);
  const direct = DIRECT.exec(name);
  if (direct) return { tool: direct[1]!.toLowerCase(), args: args ?? {} };
  if (BRIDGE.test(name) && args) {
    const inner = typeof args.tool_name === "string" ? args.tool_name.trim().toLowerCase() : "";
    if (!inner) return null;
    return { tool: inner, args: objectOf(args.arguments) ?? {} };
  }
  return null;
}

const positiveInt = (value: unknown, max: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 1 && value <= max ? value : null;

/** Which app a screen call acts on, when an app rule may cover it at all,
 * or null (a whole-screen action, the foreground, a global shortcut, a file
 * written, an unknown argument, typing into an element picked by index). */
export function screenAppTarget(tool: string | undefined, input: string | undefined): ScreenAppTarget | null {
  const call = screenCallOf(tool, input);
  if (!call) return null;
  const allowed = COVERABLE[call.tool];
  if (!allowed) return null;
  const { args } = call;
  if (Object.keys(args).some((key) => !allowed.includes(key))) return null;
  // a whole-screen action is not one app's, even when a pid rides along
  if (args.scope !== undefined && args.scope !== "window") return null;
  // the foreground falls back to the frontmost app or the HID stream
  if (args.delivery_mode !== undefined && args.delivery_mode !== "background") return null;
  if (call.tool === "press_key") {
    if (typeof args.key !== "string" || !SAFE_KEY.test(args.key.trim()) || (args.key.trim().length > 1 && /[+]/.test(args.key))) return null;
    const modifiers = args.modifiers;
    if (modifiers !== undefined && (!Array.isArray(modifiers) || modifiers.some((key) => typeof key !== "string" || !SAFE_MODIFIERS.has(key.trim().toLowerCase())))) return null;
  }
  if (TYPING.has(call.tool) && [...ELEMENT, ...AT].some((key) => args[key] !== undefined)) return null;
  const pid = positiveInt(args.pid, 4_194_304);
  if (pid === null) return null;
  let windowId: number | undefined;
  if (args.window_id !== undefined) {
    const id = positiveInt(args.window_id, 2 ** 31);
    if (id === null) return null;
    windowId = id;
  }
  return { kind: "pid", pid, ...(windowId !== undefined ? { windowId } : {}), ...(TYPING.has(call.tool) ? { focusCheck: true } : {}) };
}

/** The outermost `.app` bundle of a macOS executable path, or null for a
 * program that is not in an app bundle (a shell, a script). */
export function appBundleOf(path: string | undefined): string | null {
  const text = (path ?? "").trim();
  if (!text.startsWith("/")) return null;
  const match = /^(.*?\/[^/]+\.app)(?:\/|$)/.exec(text);
  return match?.[1] ?? null;
}

/** The app a macOS executable path belongs to: the outermost `.app` bundle
 * (`/Applications/Safari.app/Contents/MacOS/Safari` is Safari; a helper
 * inside `Google Chrome.app` is Google Chrome). */
export function appLabelFromPath(path: string | undefined): string | null {
  const bundle = appBundleOf(path);
  const label = bundle ? /\/([^/]+)\.app$/.exec(bundle)?.[1]?.trim() : undefined;
  return label && APP_NAME.test(label) ? label : null;
}

/** Bundle ids an app rule is never offered for: from them a bot reaches a
 * shell, an editor's terminal, the system, a remote computer, a password,
 * another AI agent or a message that leaves (sending stays behind its own
 * card). Exact ids and id prefixes, compared case-insensitively. */
export const NO_APP_RULE_BUNDLES: ReadonlySet<string> = new Set([
  // shells and terminals
  "com.apple.terminal", "com.googlecode.iterm2", "dev.warp.warp-stable", "com.mitchellh.ghostty", "net.kovidgoyal.kitty", "org.alacritty",
  "com.github.wez.wezterm", "co.zeit.hyper", "org.tabby", "com.termius-dmg.mac", "com.termius.mac",
  // editors and IDEs (a terminal inside)
  "com.microsoft.vscode", "com.microsoft.vscodeinsiders", "com.vscodium", "com.todesktop.230313mzl4w4u92", "com.exafunction.windsurf", "dev.zed.zed",
  "com.apple.dt.xcode", "com.sublimetext.4", "com.sublimetext.3", "com.panic.nova", "com.barebones.bbedit", "com.macromates.textmate",
  "org.vim.macvim", "org.gnu.emacs", "com.google.android.studio",
  // automation and launchers
  "com.apple.scripteditor2", "com.latenightsw.scriptdebugger8", "com.apple.automator", "com.apple.shortcuts", "com.raycast.macos",
  "com.runningwithcrayons.alfred", "com.stairways.keyboardmaestro.editor", "com.stairways.keyboardmaestro.engine", "org.hammerspoon.hammerspoon",
  "com.hegenberg.bettertouchtool",
  // the system
  "com.apple.finder", "com.apple.console", "com.apple.activitymonitor", "com.apple.systempreferences", "com.apple.settings", "com.apple.keychainaccess",
  "com.apple.passwords", "com.apple.diskutility", "com.apple.installer", "com.apple.migrateassistant", "com.apple.screensharing",
  // remote computers, VMs and containers
  "com.microsoft.rdc.macos", "com.microsoft.rdc.mac", "com.teamviewer.teamviewer", "com.philandro.anydesk", "com.p5sys.jump.mac.viewer",
  "com.lemonmojo.royaltsx.app", "dev.kdrag0n.macvirt", "io.rancherdesktop.app", "io.podmandesktop.podmandesktop", "org.virtualbox.app.virtualbox",
  "com.docker.docker", "com.utmapp.utm", "com.parallels.desktop.console", "com.vmware.fusion",
  "io.tailscale.ipn.macos", "io.tailscale.ipn.macsys", "com.apple.screencontinuity", "com.apple.remotedesktop", "com.carriez.rustdesk",
  "com.splashtop.business", "com.splashtop.personal", "tv.parsec.www", "dev.warp.warp-preview", "com.panic.prompt3", "com.vandyke.securecrt",
  // passwords
  "com.1password.1password", "com.agilebits.onepassword7", "com.bitwarden.desktop", "com.dashlane.dashlanephonefinal", "com.lastpass.lastpassmacdesktop",
  "com.keepersecurity.passwordmanager", "me.proton.pass.electron", "org.keepassxc.keepassxc", "com.markmcguill.strongbox",
  "com.markmcguill.strongbox.mac", "in.sinew.enpass-desktop", "in.sinew.enpass",
  // AI agents and Sagax itself (a bot clicking its own approval cards)
  "com.openmausbot.app", "ca.pulsatrix.sagax", "ai.x.grok", "com.openai.codex", "com.openai.chat", "ai.perplexity.mac", "com.anthropic.claudefordesktop",
  // sending
  "com.apple.mail", "com.apple.mobilesms", "com.tinyspeck.slackmacgap", "com.microsoft.teams", "com.microsoft.teams2",
  "com.microsoft.outlook", "net.whatsapp.whatsapp", "desktop.whatsapp", "ru.keepcoder.telegram", "org.telegram.desktop", "com.hnc.discord",
  "org.whispersystems.signal-desktop", "us.zoom.xos",
]);
const NO_APP_RULE_PREFIXES = ["com.jetbrains.", "com.screenconnect.", "com.connectwise.", "com.microsoft.teams", "io.tailscale.", "com.openmausbot.", "ca.pulsatrix.", "ai.x.",
  "com.splashtop.", "com.markmcguill.strongbox", "in.sinew.enpass", "org.telegram.", "net.whatsapp."];

/** The same, by the name on screen: a second wall when an app ships under
 * another bundle id. */
export const NO_APP_RULE: ReadonlySet<string> = new Set([
  "terminal", "iterm", "iterm2", "warp", "ghostty", "kitty", "alacritty", "wezterm", "hyper", "tabby", "termius",
  "visual studio code", "visual studio code - insiders", "vscodium", "code", "cursor", "windsurf", "zed", "xcode", "sublime text", "nova", "bbedit",
  "textmate", "macvim", "emacs", "intellij idea", "intellij idea ce", "pycharm", "pycharm ce", "webstorm", "goland", "rider", "clion", "phpstorm",
  "rubymine", "datagrip", "android studio", "fleet",
  "script editor", "script debugger", "automator", "shortcuts", "raycast", "alfred", "alfred 5", "keyboard maestro", "hammerspoon", "bettertouchtool",
  "finder", "console", "activity monitor", "system settings", "system preferences", "keychain access", "passwords", "disk utility", "installer",
  "migration assistant", "screen sharing", "windows app", "microsoft remote desktop", "teamviewer", "anydesk", "jump desktop", "royal tsx",
  "screenconnect", "connectwise control", "orbstack", "rancher desktop", "podman desktop", "virtualbox", "docker", "docker desktop", "utm",
  "parallels desktop", "vmware fusion", "tailscale",
  "1password", "1password 7", "1password 8", "bitwarden", "dashlane", "lastpass", "keeper password manager", "proton pass",
  "sagax", "sagax dev", "openmausbot", "grok", "grok bot", "codex", "chatgpt", "claude", "perplexity",
  "mail", "messages", "slack", "microsoft teams", "microsoft outlook", "outlook", "whatsapp", "telegram", "discord", "signal", "zoom.us", "zoom",
  "iphone mirroring", "remote desktop", "apple remote desktop", "rustdesk", "splashtop business", "splashtop personal", "parsec", "warp preview",
  "prompt 3", "securecrt", "keepassxc", "strongbox", "enpass",
]);

export function appBundleDenied(bundleId: string): boolean {
  const id = bundleId.trim().toLowerCase();
  return NO_APP_RULE_BUNDLES.has(id) || NO_APP_RULE_PREFIXES.some((prefix) => id.startsWith(prefix));
}

export function appRuleOffered(app: ScreenAppIdentity | string | null | undefined): boolean {
  if (!app) return false;
  const label = typeof app === "string" ? app : app.label;
  if (!label.trim() || NO_APP_RULE.has(label.trim().toLowerCase())) return false;
  if (typeof app !== "string" && (!app.bundleId || !app.team || appBundleDenied(app.bundleId))) return false;
  return true;
}
