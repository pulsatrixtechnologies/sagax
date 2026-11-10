/** Isolated gallery for #3260: the sign-in page of an organization server
 * shows the Sagax release (`release`), never the base `version` both
 * descriptors carry. ?skin=<id>&lang=<code>&old=1 (old=1: a server that
 * sends no release, whose `version` is shown). Not shipped in the app. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PairPage } from "../pair/PairPage";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const oldServer = params.get("old") === "1";

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, location.href).pathname;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (path === "/.well-known/sagax/environment") {
    return json({
      environmentId: "env-gallery", label: "Example Org", platform: "linux", version: "0.1.107",
      ...(oldServer ? {} : { release: "0.8.81" }),
      capabilities: { remoteSessions: true, selfUpdate: "operator", signInPreview: true },
      identity: { kind: "perspicax", protocol: "oidc", issuer: "https://id.example.com", loginPath: "/auth/oidc/login" },
    });
  }
  if (path.startsWith("/api/")) return json({ error: "unauthenticated" }, 401);
  return realFetch(input, init);
}) as typeof window.fetch;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PairPage initialCode={null} />
  </StrictMode>,
);
