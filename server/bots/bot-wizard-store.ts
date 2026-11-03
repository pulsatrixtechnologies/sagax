// The bot creation wizard's drafts (shared/bot-wizard.ts), one per bot, kept
// in the data directory so the desktop app and iOS resume the same draft. A
// small JSON file written atomically, 0600. The bot itself is an ordinary
// bot (bots.json); this file only keeps what the wizard adds: the mode, the
// step, the answers, the rule and routine picks and the two conversations.
//
// Routes: server/routes/bot-wizard.ts. Covered by bot-wizard-store.test.ts.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { WIZARD_MODES, WIZARD_STEPS, WIZARD_TOOLS_CHOICES, type WizardDraft } from "../../shared/bot-wizard.ts";
import { writeFileAtomic } from "../atomic.ts";

/** A bound on the file, never a quota a person meets. */
export const MAX_WIZARD_DRAFTS = 5_000;

const step = z.enum(WIZARD_STEPS);
const draftSchema = z.object({
  botId: z.string().regex(/^[\w-]{1,128}$/),
  owner: z.string().max(200),
  origin: z.enum(["new", "redo"]),
  mode: z.enum(WIZARD_MODES),
  step,
  visited: z.array(step),
  skipped: z.array(step),
  roleId: z.string().max(64),
  answers: z.object({ tone: z.string(), language: z.string(), does: z.string(), never: z.string(), speech: z.string() }),
  rules: z.record(z.string(), z.string()),
  routines: z.array(z.string()),
  guidedBotId: z.string().optional(),
  guidedThreadId: z.string().optional(),
  testThreadId: z.string().optional(),
  tools: z.enum(WIZARD_TOOLS_CHOICES).optional(),
  status: z.enum(["draft", "done"]),
  createdAt: z.number(),
  updatedAt: z.number(),
});
const fileSchema = z.object({ version: z.literal(1), drafts: z.record(z.string(), z.unknown()) });

export interface BotWizardStore {
  get(botId: string): WizardDraft | undefined;
  put(draft: WizardDraft): WizardDraft;
  remove(botId: string): void;
  /** A person's drafts not finished yet, newest first. */
  openFor(owner: string): WizardDraft[];
}

export function createBotWizardStore(dataDir: string): BotWizardStore {
  const file = join(dataDir, "bot-wizard-drafts.json");
  let drafts: Map<string, WizardDraft> | null = null;

  const load = (): Map<string, WizardDraft> => {
    if (drafts) return drafts;
    drafts = new Map();
    if (!existsSync(file)) return drafts;
    try {
      const parsed = fileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
      for (const [botId, raw] of Object.entries(parsed.drafts)) {
        const draft = draftSchema.safeParse(raw);
        if (draft.success && draft.data.botId === botId) drafts.set(botId, draft.data as WizardDraft);
      }
    } catch {
      // an unreadable file starts empty; the next write replaces it
    }
    return drafts;
  };

  const save = () => {
    const all = load();
    writeFileAtomic(file, `${JSON.stringify({ version: 1, drafts: Object.fromEntries(all) }, null, 2)}\n`, { mode: 0o600 });
  };

  return {
    get: (botId) => load().get(botId),
    put: (draft) => {
      const all = load();
      if (!all.has(draft.botId) && all.size >= MAX_WIZARD_DRAFTS) {
        // the oldest finished draft makes room first, then the oldest one
        const oldest = [...all.values()].sort((a, b) => Number(a.status === "draft") - Number(b.status === "draft") || a.updatedAt - b.updatedAt)[0];
        if (oldest) all.delete(oldest.botId);
      }
      all.set(draft.botId, draft);
      save();
      return draft;
    },
    remove: (botId) => {
      const all = load();
      if (all.delete(botId)) save();
    },
    openFor: (owner) => [...load().values()]
      .filter((draft) => draft.owner === owner && draft.status === "draft")
      .sort((a, b) => b.updatedAt - a.updatedAt),
  };
}
