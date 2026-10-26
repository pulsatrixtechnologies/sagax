// Codex owns history; this receipt only remembers which bot rules and which
// volatile context digest the native thread last carried.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../config.ts";
import { writeFileAtomic } from "../atomic.ts";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** Receipts written before the volatile split hold the bare instruction
 * fingerprint, as do ones still waiting for their turn to be accepted;
 * committed ones are JSON with both digests. Anything unreadable reads as
 * unknown, which re-delivers once and rewrites the file. */
export interface CodexInstructionReceipt {
  instructions: string;
  volatile?: string;
  /** Fingerprints of the volatile sections committed with `volatile`
   * (prompt-split.ts sectionFingerprints), so a later turn sends only the
   * sections that changed. */
  sections?: Record<string, string>;
  /** Section-only notes delivered since the whole half last rode. Codex
   * compacts its own thread without telling us, which can summarize away
   * the note that carried an unchanged section; the whole half rides again
   * after CODEX_SECTION_NOTES_BEFORE_FULL of them. */
  sectionNotes?: number;
}

export const CODEX_SECTION_NOTES_BEFORE_FULL = 5;

const isFingerprint = (value: string) => /^[0-9a-f]{64}$/.test(value);
const validSections = (value: unknown): value is Record<string, string> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)
  && Object.values(value as Record<string, unknown>).every((print) => typeof print === "string" && isFingerprint(print));

function parseReceipt(raw: string | undefined): CodexInstructionReceipt | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (isFingerprint(trimmed)) return { instructions: trimmed };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as { instructions?: unknown; volatile?: unknown; sections?: unknown; sectionNotes?: unknown };
      if (typeof record.instructions === "string" && isFingerprint(record.instructions)) {
        return {
          instructions: record.instructions,
          ...(typeof record.volatile === "string" && isFingerprint(record.volatile) ? { volatile: record.volatile } : {}),
          ...(typeof record.volatile === "string" && validSections(record.sections) ? { sections: record.sections } : {}),
          ...(typeof record.sectionNotes === "number" && record.sectionNotes >= 0 ? { sectionNotes: record.sectionNotes } : {}),
        };
      }
    }
  } catch {
    /* a corrupt receipt is simply unknown */
  }
  return null;
}

/** Preserve native configured rules when overriding Codex's developer slot. */
export function codexDeveloperInstructions(config: unknown, botInstructions: string): string {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Codex returned no effective configuration; cannot safely update bot instructions.");
  }
  const configured = (config as Record<string, unknown>).developer_instructions;
  if (configured != null && typeof configured !== "string") {
    throw new Error("Codex returned invalid developer instructions; cannot safely update bot instructions.");
  }
  // Native rules previously outranked the bot's user-message prefix. Keep
  // them last in the combined developer block to preserve that precedence.
  return configured
    ? `${botInstructions || "No Sagax bot-specific instructions remain."}\n\n${configured}`
    : botInstructions;
}

/** Codex compacted this native thread (a contextCompaction item): the
 * notes that carried the volatile half may be summarized away, so the
 * receipt keeps only the instructions and the next turn sends the whole
 * half again (Claude does the same on compact_boundary). */
export function forgetCodexVolatile(key: string, nativeThreadId: string): void {
  const directory = join(DATA_DIR, "codex-instructions");
  const path = join(directory, `${digest(JSON.stringify([key, nativeThreadId]))}.sha256`);
  let previous: CodexInstructionReceipt | null;
  try {
    previous = parseReceipt(readFileSync(path, "utf8"));
  } catch {
    return;
  }
  if (!previous || previous.volatile === undefined) return;
  writeFileAtomic(path, JSON.stringify({ instructions: previous.instructions }), { mode: 0o600 });
}

export async function syncCodexInstructions(
  key: string,
  nativeThreadId: string,
  instructions: string,
  volatile: string,
  resumed: boolean,
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  mentionTurn = false,
  sections?: Record<string, string>,
): Promise<{ deliverVolatile: boolean; hadVolatile: boolean; previousSections?: Record<string, string>; commitVolatile: (() => void) | null }> {
  const directory = join(DATA_DIR, "codex-instructions");
  const path = join(directory, `${digest(JSON.stringify([key, nativeThreadId]))}.sha256`);
  const fingerprint = digest(instructions);
  const volatileFingerprint = digest(volatile);
  let previous: CodexInstructionReceipt | null;
  try {
    previous = parseReceipt(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    previous = null;
  }
  if (resumed && previous?.instructions !== fingerprint) {
    // thread/resume config overrides are used after compaction, but Codex
    // 0.153.4 keeps the old initial developer message until then. Append a
    // developer update ONLY on change (or first adoption of an old session).
    // inject_items flushes native history before acknowledging; only then
    // persist our receipt. Unknown-method errors must fail, never lose rules.
    try {
      await request("thread/inject_items", {
        threadId: nativeThreadId,
        items: [{
          type: "message",
          role: "developer",
          content: [{
            type: "input_text",
            text: "The following replaces the previous developer instruction block supplied by Sagax, including its native configured rules and bot-specific instructions. Other Codex instructions and permissions still apply.\n\n"
              + (instructions || "No Sagax bot-specific instructions remain."),
          }],
        }],
      });
    } catch (error) {
      if (error instanceof Error && /method not found|unknown method/i.test(error.message)) {
        throw new Error(`This Codex version cannot update bot instructions in a resumed session. Update Codex and retry: ${error.message}`, { cause: error });
      }
      throw error;
    }
  }
  // A mention describes the turn it rides: deliver it on every tagged turn,
  // even when the volatile text is byte-identical to the previous turn's.
  const deliverVolatile = !resumed || previous?.volatile !== volatileFingerprint || mentionTurn;
  const hadVolatile = typeof previous?.volatile === "string" && previous.volatile !== digest("");
  if (!resumed || previous?.instructions !== fingerprint) {
    // Instructions-only, and only after inject_items acknowledged: the
    // volatile digest stays pending until the driver commits it after the
    // provider accepts the turn, so a submission the provider rejected
    // redelivers its context on the next attempt.
    mkdirSync(directory, { recursive: true });
    writeFileAtomic(path, JSON.stringify({ instructions: fingerprint }), { mode: 0o600 });
  }
  // The sections the native thread holds: known only on a resumed thread
  // whose committed receipt recorded them, and not after too many
  // section-only notes in a row (see sectionNotes).
  const sectionNotes = previous?.sectionNotes ?? 0;
  const previousSections = resumed && previous?.volatile !== undefined && sectionNotes < CODEX_SECTION_NOTES_BEFORE_FULL
    ? previous.sections
    : undefined;
  const nextSectionNotes = !deliverVolatile ? sectionNotes : previousSections ? sectionNotes + 1 : 0;
  const commitVolatile = previous?.instructions === fingerprint && previous?.volatile === volatileFingerprint
    && (!sections || previous.sections !== undefined)
    ? null
    : () => {
        mkdirSync(directory, { recursive: true });
        writeFileAtomic(path, JSON.stringify({
          instructions: fingerprint, volatile: volatileFingerprint,
          ...(sections ? { sections, sectionNotes: nextSectionNotes } : {}),
        }), { mode: 0o600 });
      };
  return { deliverVolatile, hadVolatile, ...(previousSections ? { previousSections } : {}), commitVolatile };
}
