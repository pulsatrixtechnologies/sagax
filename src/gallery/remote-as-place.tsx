/** Isolated gallery for headless screenshots of remote hosts as Computer
 * places (2026-11-01) and calm asleep / waking / running screens + place
 * rename. Synthetic data only. ?skin=<id>&lang=<code>&open=1&view=calm|rename */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Globe, Laptop, Monitor, Server } from "lucide-react";

import type { UnattendedHostRow } from "../../shared/remote-unattended-host";
import { hostPlaceKey } from "../../shared/remote-bot-hosts";
import { ComputerScreen } from "../components/computer/ComputerScreen";
import { ScreenPicker, type ScreenPickerItem } from "../components/computer/OrgComputerTab";
import { BotRemoteHostsSection } from "../components/remote-session/BotRemoteHostsSection";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { MascotLook } from "../../shared/mascot-look";
import type { Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const HOST = `h_${"ab".repeat(16)}`;
const enrolled: UnattendedHostRow = {
  hostId: HOST,
  hostname: "PC-A",
  org: null,
  scope: "full-control",
  installedBy: null,
  enrolledAt: "2026-10-01T00:00:00.000Z",
  expiresAt: "2026-12-30T00:00:00.000Z",
  lastSeenAt: "2026-11-01T15:00:00.000Z",
  revokedAt: null,
  state: "enrolled",
};

const catalog: UnattendedHostRow[] = [
  enrolled,
  { ...enrolled, hostId: `h_${"cd".repeat(16)}`, hostname: "Mac-Lab" },
];

const bot = {
  id: "melonie",
  threadId: "t-melonie",
  name: "Melonie",
  title: "",
  description: "",
  notifications: true,
  color: "orange",
  unread: false,
  mascotLook: { character: "shiba" } as MascotLook,
  messages: [],
  tasks: [],
} as unknown as Bot;

// Mock the bot remote-hosts API so BotRemoteHostsSection renders without a server.
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.includes("/api/bots/") && url.includes("/remote-hosts") && (!init?.method || init.method === "GET")) {
    return new Response(JSON.stringify({
      available: true,
      hosts: [enrolled],
      catalog,
      attached: [HOST],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/api/bots/") && url.includes("/remote-hosts") && init?.method === "POST") {
    return new Response(JSON.stringify({ remoteHosts: [HOST] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/api/bots/") && url.includes("/remote-hosts") && init?.method === "DELETE") {
    return new Response(JSON.stringify({ remoteHosts: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return originalFetch(input, init);
}) as typeof fetch;

const pickerItems: ScreenPickerItem[] = [
  { key: "server", label: t("orgComputer.choice.cloud"), technical: t("orgComputer.choice.cloud"), icon: Server, here: true, dot: "online" },
  { key: "desktop:d1", label: "MacBook de JC", technical: "JeanChrophesMBP.localdomain", icon: Laptop, dot: "online" },
  { key: hostPlaceKey(HOST), label: "PC-A", technical: "PC-A", icon: Monitor, dot: "asleep" },
  { key: "browser", label: t("computer.view.browser"), technical: t("computer.view.browser"), icon: Globe, dot: "offline" },
];

function Section({ name, title, children }: { name: string; title: string; children: React.ReactNode }) {
  return (
    <section data-gallery-sample={name} className="flex w-[380px] shrink-0 flex-col gap-2 rounded-xl border border-hairline/40 bg-panel p-4">
      <h3 className="text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{title}</h3>
      {children}
    </section>
  );
}

function PlaceDropdown({ open, rename }: { open: boolean; rename?: boolean }) {
  const [chosen, setChosen] = useState(rename ? "desktop:d1" : "server");
  useEffect(() => {
    if (!open && !rename) return;
    const timer = window.setTimeout(() => {
      const button = document.querySelector<HTMLButtonElement>("[data-gallery-sample='place-dropdown'] [data-computer-picker-button]");
      button?.click();
      if (!rename) return;
      window.setTimeout(() => {
        const row = document.querySelector<HTMLElement>("[data-gallery-sample='place-dropdown'] [data-computer-choice='desktop:d1']");
        row?.querySelector<HTMLButtonElement>("[data-computer-rename]")?.click();
      }, 120);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [open, rename]);
  return (
    <div data-gallery-computer="" className="flex flex-col gap-3">
      <ScreenPicker items={pickerItems} chosen={chosen} onPick={setChosen} onRename={() => {}} />
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-hairline/50 bg-raised/40 px-4 py-10 text-center">
        <Server size={28} className="text-ink-secondary" aria-hidden="true" />
        <p className="text-[13px] text-ink">{t("orgComputer.choice.cloud")}</p>
      </div>
    </div>
  );
}

function CalmScreens({ revealOpen }: { revealOpen: boolean }) {
  useEffect(() => {
    if (!revealOpen) return;
    const timer = window.setTimeout(() => {
      const frame = document.querySelector<HTMLElement>("[data-gallery-sample='running'] [data-controls]");
      if (!frame) return;
      frame.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true, pointerType: "mouse" }));
      frame.focus();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [revealOpen]);
  const caption = t("computer.screenOf", { name: bot.name });
  return (
    <>
      <Section name="asleep" title="Asleep (calm)">
        <ComputerScreen
          source="server"
          state="off"
          caption={caption}
          bot={bot}
          computerName={t("orgComputer.choice.cloud")}
          controls={{ play: () => {} }}
        />
      </Section>
      <Section name="waking" title="Waking">
        <ComputerScreen
          source="server"
          state="starting"
          caption={caption}
          bot={bot}
          computerName={t("orgComputer.choice.cloud")}
        />
      </Section>
      <Section name="running" title="Running + Open">
        <ComputerScreen
          source="server"
          state="running"
          caption={caption}
          bot={bot}
          computerName={t("orgComputer.choice.cloud")}
          onOpen={() => {}}
          controls={{ pause: () => {}, stop: () => {} }}
          live={
            <div
              data-gallery-live=""
              className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950 text-[12px] text-white/70"
            >
              live desktop
            </div>
          }
        />
      </Section>
    </>
  );
}

function Gallery() {
  const open = params.get("open") === "1";
  const view = params.get("view") ?? "places";
  if (view === "calm") {
    return (
      <div className="flex min-h-screen flex-wrap items-start gap-6 bg-app p-5 text-ink">
        <CalmScreens revealOpen />
      </div>
    );
  }
  if (view === "rename") {
    return (
      <div className="flex min-h-screen flex-wrap items-start gap-6 bg-app p-5 text-ink">
        <Section name="place-dropdown" title="Rename place">
          <PlaceDropdown open rename />
        </Section>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen flex-wrap items-start gap-6 bg-app p-5 text-ink">
      <Section name="place-dropdown" title="Computer place dropdown">
        <PlaceDropdown open={open} />
      </Section>
      <Section name="endpoints" title="Endpoints on this bot">
        <BotRemoteHostsSection botId="melonie" />
        <ExpandEndpoints />
      </Section>
      <Section name="details-clean" title="Details (no remote sessions)">
        <div data-gallery-details="" className="flex flex-col gap-3 text-[13px] text-ink-secondary">
          <p>{t("botPanel.tab.details")}</p>
          <p className="rounded-lg border border-hairline/40 bg-raised/30 px-3 py-2">Suggestions</p>
          <p className="rounded-lg border border-hairline/40 bg-raised/30 px-3 py-2">Activity</p>
          <p className="rounded-lg border border-hairline/40 bg-raised/30 px-3 py-2">Routines</p>
          <p data-gallery-no-remote-sessions="" className="text-[12px] text-ink-tertiary">
            Remote sessions live in Computer, not here.
          </p>
        </div>
      </Section>
    </div>
  );
}

function ExpandEndpoints() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>("[data-gallery-sample='endpoints'] [data-bot-remote-hosts-toggle]")?.click();
    }, 80);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
