// Dev gallery (#2901, 2026-11-08, « rien d'invisible »): what a bot said or
// asked in a background conversation (MCP send_prompt, routine run,
// proactive wake, teammate work), copied into the bot's chat with its
// discreet provenance label, the way MessagesListItem draws it. The either/or
// question shows its two paths, never Oui/Non. #3581: a request from an AI
// client or a teammate is the "Asked by" names line, never its quoted words
// nor a bubble with the reply (the reply opens from the name); a routine's
// trace is said on its label's line. Not part of the packaged app.
// ?lang=fr|en&skin=<id>
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DesktopCapabilitiesProvider } from "@/components/DesktopCapabilities";
import { OptionCard } from "@/components/OptionCard";
import { RelayProvenance, RelayViaLabel } from "@/components/RelayViaLabel";
import { loadLocale } from "@/lib/i18n";
import { applySkin, type SkinId } from "@/lib/skins";
import { BotEditorStore, type Message, type useStore } from "@/state/store";
import { choiceOptionsFor } from "../../server/approvals/final-confirmation";
import "../styles.css";

const params = new URLSearchParams(location.search);
await loadLocale(params.get("lang") ?? "fr");
applySkin((params.get("skin") ?? "pulsatrix") as SkinId);

// a fixed store: the real one would fetch the server this page has not got
const store = {
  state: { bots: [], instances: [], selectedId: "preview-bot" },
  dispatch: () => {},
  flushBotPatches: async () => null,
} as unknown as ReturnType<typeof useStore>;

const AB = "Veux-tu que je refasse la collecte à neuf, ou qu'on avance directement avec ta validation ?";

function Row({ id, children }: { id: string; children: ReactNode }) {
  return <section data-variant={id} className="flex flex-col items-start p-4">{children}</section>;
}

function card(id: string, via: Message["relayVia"], more: Partial<NonNullable<Message["card"]>>): Message {
  return { id, role: "bot", kind: "options", at: 1, relayVia: via, card: { title: "", subtitle: "", options: [], requestId: `origin:${id}`, ...more } } as Message;
}

function relay(id: string, via: Message["relayVia"], by: { by: string }): Message {
  return { id, role: "bot", kind: "text", at: 1, text: "J'ai fermé les 3 billets en double.", relayVia: via, relayAsk: { text: "Ferme les billets en double du client.", ...by } } as Message;
}

function Preview() {
  const ab = card("ab", "routine", { title: AB, options: choiceOptionsFor(AB, ["Oui", "Non"]), tool: "ask_choice" });
  const wake = card("wake", "proactive", { title: "Courriel reçu : le contrat est prêt à signer. Je réponds que tu le regardes demain ?", options: ["Oui, réponds-lui", "Non, attends"], tool: "ask_choice" });
  return (
    <div className="min-h-screen bg-app text-ink" data-gallery>
      <div className="mx-auto flex max-w-[760px] flex-col">
        <Row id="mcp">
          <RelayProvenance message={relay("mcp", "mcp", { by: "Client" })} bots={[]} />
        </Row>
        <Row id="routine">
          <RelayViaLabel message={ab} />
          <OptionCard botId="preview-bot" threadId="t" message={ab} />
        </Row>
        <Row id="proactive">
          <RelayViaLabel message={wake} />
          <OptionCard botId="preview-bot" threadId="t" message={wake} />
        </Row>
        <Row id="mcp-ask-card">
          <RelayProvenance message={card("mcp-card", "mcp", { title: "Je ferme les 3 billets en double ?", options: ["Oui", "Non"], tool: "ask_choice" })} bots={[]} />
          <OptionCard botId="preview-bot" threadId="t" message={card("mcp-card", "mcp", { title: "Je ferme les 3 billets en double ?", options: ["Oui", "Non"], tool: "ask_choice" })} />
        </Row>
        <Row id="trace-silent">
          <RelayViaLabel message={{ relayVia: "routine", relayTrace: "silent" }} />
        </Row>
        <Row id="teammate">
          <RelayProvenance message={relay("teammate", "teammate", { by: "Bot B" })} bots={[]} />
        </Row>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={store}>
      <DesktopCapabilitiesProvider>
        <Preview />
      </DesktopCapabilitiesProvider>
    </BotEditorStore>
  </StrictMode>,
);
