// Client helpers for the per-person Linked Grok bridge (#2193).
import { api } from "@/state/store";
import type { GrokBridgeLinkView } from "../../shared/grok-bridge";

export type { GrokBridgeLinkView };

export const loadGrokBridge = () => api<GrokBridgeLinkView>("/api/me/grok-bridge");

export function saveGrokBridge(body: {
  webhookUrl?: string;
  key?: string | null;
  enabled?: boolean;
  bots?: string[];
  mayCallOwner?: boolean;
  mayTextOwner?: boolean;
  clear?: boolean;
}): Promise<GrokBridgeLinkView> {
  return api("/api/me/grok-bridge", { method: "PUT", body: JSON.stringify(body) });
}

export function clearGrokBridge(): Promise<GrokBridgeLinkView> {
  return api("/api/me/grok-bridge", { method: "DELETE" });
}

export function testGrokBridge(): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
  return api("/api/me/grok-bridge/test", { method: "POST", body: "{}" });
}
