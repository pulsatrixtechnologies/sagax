import { VideoJobError, type VideoCredential, type VideoPayer } from "./video-generation.ts";
import type { ProviderKeyResult } from "./perspicax-link.ts";

/** Same sealed personal accounts and explicit xaiImage org grant as the
 * existing media pipeline. Recovery never changes who pays for a job. */
export async function videoCredential(input: {
  organization: boolean;
  personal(): Promise<ProviderKeyResult>;
  solo(): Promise<string | undefined>;
  organizationAllowed(): boolean;
  organizationKey(): string | undefined;
}, payer?: VideoPayer): Promise<VideoCredential> {
  if (!input.organization) {
    if (payer && payer !== "solo") throw new VideoJobError("The video's original provider account is unavailable.");
    const key = await input.solo();
    if (!key) throw new VideoJobError("Add your xAI API key in Settings > Providers to generate videos. A Grok subscription does not supply this API key.");
    return { key, payer: "solo" };
  }
  if (payer === "solo") throw new VideoJobError("The video's original provider account is unavailable.");
  if (payer !== "organization") {
    const personal = await input.personal();
    if (personal.ok) return { key: personal.key, payer: "personal" };
    if (payer === "personal" || personal.error !== "no_key") throw new VideoJobError("Your personal xAI account is unavailable. Reconnect it in Settings > Providers; this job will not switch to another payer.", 503);
  }
  if (!input.organizationAllowed()) throw new VideoJobError("Your organization has not given you image and video generation on its xAI key. You can add your own xAI key in Settings > Providers.", 403);
  const key = input.organizationKey();
  if (!key) throw new VideoJobError("No xAI video API key is configured. Add your own in Settings > Providers.");
  return { key, payer: "organization" };
}
