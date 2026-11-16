/** Isolated gallery for #1533: a person's Claude sign-in that the provider
 * refused since. The engine card (EngineConnect), the chat's access card
 * (AccessCard) and the "Provided by Claude (your account)" box
 * (HarnessConnectorsSection, its answers stubbed by the capture script).
 * Not shipped in the app. ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AccessCard } from "../components/AccessCard";
import { EngineConnect } from "../components/EngineConnect";
import { HarnessConnectorsSection } from "../components/HarnessConnectorsSection";
import { loadLocale } from "../lib/i18n";
import type { MyEngine } from "../lib/perspicax-org";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "../state/store";
import type { WireAccessCard } from "../../shared/wire";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

export const EXPIRED_CLAUDE: MyEngine = {
  instanceId: "claude", driver: "claudeAgent", displayName: "Claude", installed: true,
  subscription: { supported: true, signedIn: true, expired: true }, myKey: false, orgKey: false, myTurns: "subscription",
};
const card: WireAccessCard = {
  reason: "no_access", cause: "sign_in_expired", engine: "Claude", botId: "b1", botName: "Helper",
  ownerPrincipalId: "pr_member", payerPrincipalId: "pr_member", subscriptionSignIn: true,
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <aside data-gallery-panel="" className="flex w-[460px] flex-col gap-4 border-r border-hairline/40 bg-panel px-4 py-4 text-ink">
        <HarnessConnectorsSection />
        <div className="rounded-xl border border-hairline/40 px-3.5 py-2.5">
          <div className="mb-1 text-[13px] font-medium">Claude</div>
          <EngineConnect engine={EXPIRED_CLAUDE} issuer="https://px.example.test" onChanged={() => undefined} />
        </div>
        <AccessCard access={card} viewer={{ principalId: "pr_member", admin: false }} onSignIn={() => undefined} />
      </aside>
    </StoreProvider>
  </StrictMode>,
);
