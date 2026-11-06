// Client helpers for memes (#2121). The provider key never leaves the server.
import type { MemeSearchHit, MemeSettingsView } from "../../shared/memes";
import { api } from "@/state/store";

export type { MemeSearchHit, MemeSettingsView };

export function loadMemeSettings(): Promise<MemeSettingsView> {
  return api<MemeSettingsView>("/api/me/memes");
}

export function saveMemeSettings(input: { provider: "tenor" | "giphy"; key?: string }): Promise<MemeSettingsView> {
  return api<MemeSettingsView>("/api/me/memes", { method: "PUT", body: JSON.stringify(input) });
}

export function removeMemeSettings(): Promise<MemeSettingsView> {
  return api<MemeSettingsView>("/api/me/memes", { method: "DELETE" });
}

export interface MemeSearchResponse {
  hits: MemeSearchHit[];
  keyConfigured: boolean;
  setupHint?: string;
  keysUrl?: string;
}

export function searchMemes(query: string): Promise<MemeSearchResponse> {
  const q = query.trim();
  const path = q ? `/api/memes/search?q=${encodeURIComponent(q)}` : "/api/memes/trending";
  return api<MemeSearchResponse>(path);
}

export interface MaterializedMeme {
  attachment: {
    kind: "image";
    path: string;
    mime: string;
    name?: string;
    meme?: {
      provider: "giphy" | "tenor" | "imgflip" | "upload";
      attribution: string;
      caption?: string;
      sourceId?: string;
    };
  };
}

export function materializeMeme(hit: MemeSearchHit, caption?: string): Promise<MaterializedMeme> {
  return api<MaterializedMeme>("/api/memes/materialize", {
    method: "POST",
    body: JSON.stringify({
      id: hit.id,
      url: hit.url,
      provider: hit.provider,
      attribution: hit.attribution,
      title: hit.title,
      ...(caption?.trim() ? { caption: caption.trim() } : {}),
    }),
  });
}
