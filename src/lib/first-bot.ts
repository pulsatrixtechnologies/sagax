// Create the first bot with the very same Auto defaults the New bot dialog
// opens on (#1034). This is not a second creation path: it reads the server's
// own `GET /api/bot-defaults` (engine auto-resolved, model Auto) and posts it
// to the same `POST /api/bots` the dialog uses, leaving the approval level
// untouched so a new bot keeps starting on "Approve for me". It exists so the
// guided first run can offer one real click — "create my first bot" — instead
// of walking a person through the whole dialog.
import { api as defaultApi, type Bot } from "@/state/store";

interface BotDefaultsResponse {
  modelSelection?: { instanceId: string; model: string; auto?: boolean; effort?: string; variant?: string };
}

/** True once the server's default selection names a ready engine and model;
 * an empty selection means no engine is connected yet, so there is nothing to
 * create against. */
export function autoSelectionReady(selection: BotDefaultsResponse["modelSelection"]): boolean {
  return Boolean(selection && selection.instanceId.trim() && selection.model.trim());
}

/** Create the first bot on Auto. The engine and model come from the server's
 * Auto default; the approval level is deliberately not sent, so the server's
 * own default (Approve for me, never Full) stands. Returns the created bot so
 * the caller can drop the person into its chat. */
export async function createAutoFirstBot(request: typeof defaultApi = defaultApi): Promise<Bot> {
  const defaults = await request<BotDefaultsResponse>("/api/bot-defaults");
  const selection = defaults.modelSelection;
  // Pass the Auto selection when the server resolved one; otherwise let the
  // server pick, rather than posting an empty selection that would pin nothing.
  const body = autoSelectionReady(selection) ? { modelSelection: selection } : {};
  const { bot } = await request<{ bot: Bot }>("/api/bots", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return bot;
}
