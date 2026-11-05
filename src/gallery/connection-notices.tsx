/** Isolated gallery for headless screenshots of #2013: the connection notice
 * pills (server updating, server unreachable, Perspicax unreachable,
 * Reconnected) and the composer line for a pre-send refusal (configuration
 * conflict with Fix, engine not ready with Try again, sign-in expired).
 * Not shipped in the app. ?lang=<code>&skin=<id> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConnectionNoticePill } from "../components/ConnectionNotice";
import { ComposerSendBlock } from "../components/ComposerSendBlock";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { sendBlockFor } from "../../shared/send-state";
import { CODEX_AMBIENT_MCP_REFUSAL } from "../../shared/presend-refusal";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const engine = { instanceId: "codex", name: "Codex" };
const base = { auto: false, engine, accessRefused: false, ownerComputerOffline: null, local: "unknown" as const };
const blocks = [
  sendBlockFor({ ...base, refused: { kind: "config_conflict", cause: `${CODEX_AMBIENT_MCP_REFUSAL} No prompt was sent.`, fix: "codex_native_mcp" } })!,
  sendBlockFor({ ...base, refused: { kind: "engine_not_ready", cause: "Codex could not confirm its shell environment policy. No prompt was sent." } })!,
  sendBlockFor({ ...base, refused: { kind: "signed_out", cause: "Codex sign-in expired. Sign in again." } })!,
];
const noop = () => {};

function Gallery() {
  return (
    <main className="min-h-screen bg-app p-8 text-ink">
      <section data-gallery-notices className="flex flex-col items-center gap-3">
        {(["updating", "server_unreachable", "perspicax_unreachable", "reconnected"] as const).map((kind) => (
          <ConnectionNoticePill key={kind} kind={kind} onDismiss={noop} />
        ))}
      </section>
      <section data-gallery-composer className="mx-auto mt-10 flex max-w-[720px] flex-col gap-6">
        {blocks.map((block) => (
          <div key={block.reason + (block.refusal?.kind ?? "")} className="rounded-2xl border border-hairline/50 bg-composer px-3 pb-3 pt-2">
            <ComposerSendBlock block={block} onConnect={noop} onRetry={noop} onResend={noop} onFix={async () => {}} />
            <div className="rounded-xl px-2 py-2 text-[14px] text-ink-tertiary">Message Codex</div>
          </div>
        ))}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
