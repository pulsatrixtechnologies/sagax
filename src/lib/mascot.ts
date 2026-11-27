import { CURSOR_STATES, type CursorState } from "@/components/CursorAvatar";
import { botShowsUnread } from "./bot-unread";
import { lastNonReceipt } from "./receipts";
import { MASCOT_COLOR_HEX, MASCOT_COLOR_NAMES, mascotColorsIn, relativeLuminance, type MascotColorName } from "../../shared/mascot-colors";

/** A dark color lifted toward white, so it still reads as text on a dark surface. */
function liftInk(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const lift = (shift: number) => Math.round(((n >> shift) & 255) * 0.45 + 255 * 0.55);
  return `#${[16, 8, 0].map((shift) => lift(shift).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** The mascot's behaviour vocabulary — CursorAvatar's 39 states, under the
 * app's historical names. */
export type MausState = CursorState;
export const MAUS_STATES = CURSOR_STATES;

/** CursorAvatar ships French group labels; the app shows these instead. The
 * memberships mirror its STATE_GROUPS exactly. */
export const STATE_GROUPS = {
  Lifecycle: ["sleeping", "waking", "idle", "listening", "thinking", "searching", "working"],
  Reactions: [
    "excited",
    "surprised",
    "suspicious",
    "angry",
    "drowsy",
    "happy",
    "curious",
    "confused",
    "bored",
    "proud",
    "shy",
    "sad",
    "laughing",
    "scared",
    "playful",
    "celebrate",
  ],
  "Agent morphs": ["orbit", "radar", "progress"],
  "Product cycle": [
    "spawning",
    "humming",
    "loading",
    "dictating",
    "writing",
    "sending",
    "receiving",
    "uploading",
    "notifying",
    "alerting",
    "dragging",
    "bouncing",
    "powering-down",
  ],
} satisfies Record<string, MausState[]>;

/** Every bot color name (shared/mascot-colors.ts): the original fifteen first, then the newer palettes. */
export const MAUS_COLOR_NAMES = MASCOT_COLOR_NAMES;

export type MausColor = MascotColorName;

export const MAUS_COLORS: Readonly<Record<MausColor, string>> = MASCOT_COLOR_HEX;

/** Whether a colour is a #rrggbb value (the only form a mascot's paint takes as it is). */
export function isHexColor(color: string | null | undefined): color is string {
  return typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color);
}

/** A bot colour's value: a colour name, or any #rrggbb as it is; anything else reads as `fallback`. */
export function mascotHex(color: string, fallback: string = MAUS_COLORS.green): string {
  return (MAUS_COLORS as Record<string, string>)[color] ?? (isHexColor(color) ? color : fallback);
}

/**
 * A bot colour used as text or a tint on the app's own surfaces. Black has no
 * light of its own and would vanish on a dark theme, so it reads as a cool
 * slate there instead; the deep palette and graphite are lifted toward white
 * the same way. Every other colour is its palette value.
 */
export const MAUS_INK: Record<MausColor, string> = {
  ...MAUS_COLORS,
  // the deep palette, lifted the same way: it is a tint, never a vanishing ink
  ...Object.fromEntries(mascotColorsIn("deep").map((name) => [name, liftInk(MAUS_COLORS[name])])),
  graphite: "#9AA0AB",
  black: "#8B93A3",
};

export function mausInk(color: string | null | undefined): string | undefined {
  return color && Object.hasOwn(MAUS_INK, color) ? MAUS_INK[color as MausColor] : undefined;
}

/**
 * A colour swatch's paint. The darkest swatches (black, midnight...) also get
 * an inner hairline so they still read as buttons on a dark card.
 */
export function swatchStyle(color: MausColor): { backgroundColor: string; boxShadow?: string } {
  return {
    backgroundColor: MAUS_COLORS[color] ?? MAUS_COLORS.green,
    ...(relativeLuminance(MAUS_COLORS[color] ?? MAUS_COLORS.green) < 0.035 ? { boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.32)" } : {}),
  };
}

export const MAUS_MOTIONS = [
  "arrive",
  "switch",
  "customize",
  "alert",
  "thinking",
  "working",
  "launch",
  "success",
  "celebrate",
  "blink",
  "surprise",
  "failure",
  // wing moves: the owl opens its wings
  "spread-wings",
  "flap",
  "take-off",
  "shake",
  "hoot",
] as const;

/**
 * The motions that are only wing moves, in the order the appearance card
 * offers them to try. `celebrate`, `success` and `launch` use the wings too,
 * but they are app beats first.
 */
export const MAUS_WING_MOTIONS = ["spread-wings", "flap", "take-off", "shake", "hoot"] as const satisfies readonly MausMotion[];

export type MausMotion = "none" | (typeof MAUS_MOTIONS)[number];

/**
 * The face used to be ten hand-drawn SVGs; it is now the engine's 39 states.
 * Bots saved under the old vocabulary still carry one of these ten names, so
 * they are translated on read rather than migrated in place — a bot's stored
 * face should survive a downgrade too.
 */
interface LegacyStates {
  [state: string]: MausState;
}

const LEGACY_STATES: LegacyStates = {
  deadpan: "idle",
  friendly: "happy",
  focused: "working",
  thinking: "thinking",
  excited: "excited",
  sleepy: "drowsy",
  surprised: "surprised",
  skeptical: "suspicious",
  worried: "scared",
  mischievous: "playful",
};

const KNOWN_STATES = new Set<string>(MAUS_STATES);

/** Resolves any stored value — current, legacy or junk — to a real state. */
export function normalizeState(value: string | null | undefined): MausState | null {
  if (!value) return null;
  if (KNOWN_STATES.has(value)) return value as MausState;
  return LEGACY_STATES[value] ?? null;
}

/**
 * The states worth offering in the appearance picker.
 *
 * The engine carries 39, but many are transient beats the app drives itself
 * (`sending`, `alerting`, `powering-down`) and make no sense as a bot's resting
 * face. More importantly, states share resting faces: `happy`, `excited` and
 * `playful` all rest on expression 2, and `curious`, `surprised` and `scared`
 * all rest on 3 — they differ in which faces they *drift* to, which a static
 * swatch cannot show. Offering them all gave 15 buttons showing 8 pictures.
 *
 * Across all 39 states there are only 11 distinct resting faces, so this is one
 * state per face, chosen for the clearest name. Every swatch looks different.
 */
export const PICKABLE_STATES: MausState[] = [
  "idle", // expression 0
  "happy", // 2
  "curious", // 3
  "drowsy", // 4
  "working", // 7
  "thinking", // 8
  "listening", // 10
  "sleeping", // 13
  "suspicious", // 14
  "proud", // 15
];

type MascotMessage = {
  kind: string;
  tool?: { ok?: boolean };
};

export type MascotBotProfile = {
  name: string;
  title?: string;
  description?: string;
  mascotExpression?: string | null;
  busy?: boolean;
  /** What the bot is doing as the harness sees it (the sidebar's waiting dot reads the same field). */
  activity?: string;
  unread?: boolean;
  tasks?: Array<{ unread?: boolean; routineRunId?: string; activity?: string }> | null;
  messages?: MascotMessage[];
};

/**
 * What a bot is doing right now, read once for every mascot: a card that
 * waits for the person, a step that failed, a turn that runs, a finished
 * turn not read yet, a question on screen. Nothing of the bot's profile and
 * no pinned face: only what is happening.
 */
/** The live fields of a bot the mascots read. */
export type MascotLiveBot = Pick<MascotBotProfile, "busy" | "activity" | "unread" | "tasks" | "messages"> & Partial<Pick<MascotBotProfile, "name" | "title" | "description" | "mascotExpression">>;

function liveSignals(bot: MascotLiveBot) {
  // the harness's receipts (digest, compaction) follow every turn; the mood
  // reads the last row a person reads, not the record about it
  const last = lastNonReceipt(bot.messages);
  return {
    last,
    waiting: bot.activity === "waiting-on-you" || Boolean(bot.tasks?.some((task) => task.activity === "waiting-on-you")),
    failed: last?.kind === "activity" && last.tool?.ok === false,
    busy: Boolean(bot.busy),
    unread: botShowsUnread(bot),
    question: last?.kind === "options",
  };
}

/** The six states an agent moves through, as the open-bot-avatar engine draws them (#5276). */
export const AGENT_STATES = ["idle", "thinking", "working", "waiting", "blocked", "done"] as const;
export type AgentState = (typeof AGENT_STATES)[number];

/**
 * The engine's state for what the bot is really doing (#5349), from the same
 * live signals as stateForBot: it waits while a card or a question waits for
 * the person, is blocked on a failed step, thinks while a turn runs and
 * nothing has come out, works once a step is on screen, is done while a
 * finished turn is unread, and rests otherwise. A pinned face and the bot's
 * profile never set it: nobody chooses a fixed state.
 */
export function agentStateForBot(bot: MascotLiveBot): AgentState {
  const live = liveSignals(bot);
  if (live.waiting) return "waiting";
  if (live.failed) return "blocked";
  if (live.busy || bot.activity === "working") return live.last?.kind === "activity" ? "working" : "thinking";
  if (live.unread) return "done";
  if (live.question) return "waiting";
  return "idle";
}

/**
 * Selects a state from live state first, then from what the bot is about.
 * The keyword groups deliberately overlap as little as possible so a bot's
 * visual identity stays stable while its title and description are edited.
 */
export function stateForBot(bot: MascotBotProfile): MausState {
  const pinned = normalizeState(bot.mascotExpression);
  if (pinned) return pinned;

  const live = liveSignals(bot);
  if (live.failed) return "alerting";
  if (live.busy) return "working";
  if (live.unread) return "notifying";
  if (live.question) return "curious";

  const profile = `${bot.name} ${bot.title ?? ""} ${bot.description ?? ""}`.toLowerCase();
  const matches = (words: RegExp) => words.test(profile);

  if (matches(/\b(code|coding|developer|development|engineer|engineering|build|debug|program|software)\b/)) {
    return "working";
  }
  if (matches(/\b(research|researcher|search|investigate|strategy|strategist|study|learn|knowledge)\b/)) {
    return "searching";
  }
  if (matches(/\b(marketing|growth|launch|campaign|social|sales|outreach|brand)\b/)) {
    return "excited";
  }
  if (matches(/\b(overnight|night|background|async|queue|batch|long-running)\b/)) {
    return "idle";
  }
  if (matches(/\b(monitor|monitoring|incident|alert|watch|status|uptime)\b/)) {
    return "radar";
  }
  if (matches(/\b(review|reviewer|audit|critic|critique|quality|qa|test|legal)\b/)) {
    return "suspicious";
  }
  if (matches(/\b(security|secure|compliance|risk|privacy|finance|financial)\b/)) {
    return "scared";
  }
  if (matches(/\b(design|designer|creative|brainstorm|art|illustration|music|story)\b/)) {
    return "playful";
  }
  if (matches(/\b(support|help|success|onboarding|coach|teacher|guide|welcome)\b/)) {
    return "happy";
  }

  return "idle";
}
