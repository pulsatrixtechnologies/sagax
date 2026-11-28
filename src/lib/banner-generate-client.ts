// Ask the existing image generator for a wide bot-page banner
// (POST /api/bots/:id/banner/generate). Same provider chain as the avatar.
import { api } from "@/state/store";

export async function generateBotBanner(botId: string, prompt: string): Promise<{ bannerUrl: string }> {
  const response = await api(`/api/bots/${encodeURIComponent(botId)}/banner/generate`, {
    method: "POST",
    body: JSON.stringify({ prompt }),
  }) as { bannerUrl?: string };
  if (!response?.bannerUrl || typeof response.bannerUrl !== "string") throw new Error("no banner");
  return { bannerUrl: response.bannerUrl };
}
