import { describe, expect, it } from "vitest";

import { IMAGE_SERVER_ENGINE } from "../../shared/image-generation.ts";
import { VOICE_SERVER_ENGINE } from "../../shared/voice-mode.ts";
import { ORG_XAI_MEDIA_ENGINE, orgXaiKeyAllowed, orgXaiMediaStatusFor, orgXaiRefusal } from "./org-xai-media.ts";

// serverEngineAllowedFor in miniature: an admin always, a member by their list.
const LISTS: Record<string, string[] | null> = {
  pr_admin: null,
  pr_voice: [VOICE_SERVER_ENGINE],
  pr_image: [IMAGE_SERVER_ENGINE],
  pr_star: ["*"],
  pr_codex: ["codex"],
  pr_unknown: null,
};
const allowed = (principalId: string, engineId: string) => {
  if (principalId === "pr_admin") return true;
  const list = LISTS[principalId] ?? null;
  return list !== null && (list.includes("*") || list.includes(engineId));
};
const org = (principalId?: string | null, ownerPrincipalId?: string | null) => ({ organization: true, principalId, ownerPrincipalId, allowed });

describe("the organization's xAI key for speech and images, per person (2026-10-16)", () => {
  it("uses the ids a person sheet's sagax_server_engines lists", () => {
    expect(ORG_XAI_MEDIA_ENGINE).toEqual({ voice: "xaiVoice", image: "xaiImage" });
  });

  it("serves an admin always", () => {
    expect(orgXaiKeyAllowed("voice", org("pr_admin"))).toBe(true);
    expect(orgXaiKeyAllowed("image", org("pr_admin"))).toBe(true);
  });

  it("serves a member only for the ids on their list, or every one with *", () => {
    expect(orgXaiKeyAllowed("voice", org("pr_voice"))).toBe(true);
    expect(orgXaiKeyAllowed("image", org("pr_voice"))).toBe(false);
    expect(orgXaiKeyAllowed("image", org("pr_image"))).toBe(true);
    expect(orgXaiKeyAllowed("voice", org("pr_image"))).toBe(false);
    expect(orgXaiKeyAllowed("voice", org("pr_star"))).toBe(true);
    expect(orgXaiKeyAllowed("image", org("pr_star"))).toBe(true);
    // an engine on the list is not the voice or the images
    expect(orgXaiKeyAllowed("voice", org("pr_codex"))).toBe(false);
    expect(orgXaiKeyAllowed("image", org("pr_codex"))).toBe(false);
  });

  it("serves nobody when the list is unknown or nobody is named", () => {
    expect(orgXaiKeyAllowed("voice", org("pr_unknown"))).toBe(false);
    expect(orgXaiKeyAllowed("voice", org(null))).toBe(false);
    expect(orgXaiKeyAllowed("image", org("  "))).toBe(false);
  });

  it("judges a use nobody is known to be for as the bot owner's, never as the owner's when someone is named", () => {
    expect(orgXaiKeyAllowed("voice", org(null, "pr_admin"))).toBe(true);
    expect(orgXaiKeyAllowed("voice", org(undefined, "pr_codex"))).toBe(false);
    // the speaker is judged, not the owner who was given it
    expect(orgXaiKeyAllowed("voice", org("pr_codex", "pr_admin"))).toBe(false);
  });

  it("changes nothing on a solo server", () => {
    expect(orgXaiKeyAllowed("voice", { organization: false, principalId: null, allowed: () => false })).toBe(true);
    expect(orgXaiKeyAllowed("image", { organization: false, principalId: "pr_codex", allowed: () => false })).toBe(true);
  });

  it("refuses with server_engine_not_allowed and no key", () => {
    for (const media of ["voice", "image"] as const) {
      const body = orgXaiRefusal(media);
      expect(body.cause).toBe("server_engine_not_allowed");
      expect(body.error).toMatch(/admin/);
    }
  });

  it("shows the xAI voice and images as not configured for a person not given them", () => {
    const status = {
      tts: { provider: "xai", configured: true, ready: true, voice: "eve" },
      imageGen: { provider: "xai", configured: true, xaiConfigured: true, openaiConfigured: false },
    };
    expect(orgXaiMediaStatusFor(status, { voice: true, image: true })).toBe(status);
    expect(orgXaiMediaStatusFor(status, { voice: false, image: false })).toEqual({
      tts: { provider: "xai", configured: false, ready: false, voice: "eve", xaiKeyNotGiven: true },
      imageGen: { provider: "xai", configured: false, xaiConfigured: false, openaiConfigured: false, xaiKeyNotGiven: true },
    });
    // another provider is untouched (only xaiConfigured is narrowed)
    const other = { tts: { provider: "elevenlabs", configured: true, ready: true }, imageGen: { provider: "openai", configured: true, xaiConfigured: true } };
    expect(orgXaiMediaStatusFor(other, { voice: false, image: false })).toEqual({
      tts: other.tts,
      imageGen: { provider: "openai", configured: true, xaiConfigured: false, xaiKeyNotGiven: true },
    });
  });
});
