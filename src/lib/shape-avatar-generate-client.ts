// Ask the bot's Auto / model selection for an open-bot-avatar definition
// (POST /api/bots/:id/shape-avatar/generate), for the mascot picker's
// Generate panel (#5369, #5450). Returns the definition as JSON text the
// picker's Import path already accepts (parseEngineAvatar).
import { api } from "@/state/store";

export async function generateBotShapeAvatar(botId: string, direction: string): Promise<string> {
  const response = await api(`/api/bots/${encodeURIComponent(botId)}/shape-avatar/generate`, {
    method: "POST",
    body: JSON.stringify({ direction }),
  }) as { def?: unknown };
  if (!response?.def || typeof response.def !== "object") throw new Error("no definition");
  return JSON.stringify(response.def);
}
