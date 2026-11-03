/** Isolated gallery for headless screenshots of remote hosts as Computer
 * places (2026-11-01) and temporary attended sessions in Details. Synthetic
 * data only. ?skin=<id>&lang=<code>&open=1&view=calm|rename|details */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Globe, Laptop, Monitor, Server } from "lucide-react";

import { hostPlaceKey } from "../../shared/remote-bot-hosts";
import type { RemoteSessionView } from "../../shared/remote-session";
import { ComputerScreen } from "../components/computer/ComputerScreen";
import { ScreenPicker, type ScreenPickerItem } from "../components/computer/OrgComputerTab";
import { RemoteSessionsPanel } from "../components/remote-session/RemoteSessionsSection";
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
const OTHER = `h_${"cd".repeat(16)}`;

const bot = {
  id: "wren",
  threadId: "t-wren",
  name: "Wren",
  title: "",
  description: "",
  notifications: true,
  color: "orange",
  unread: false,
  mascotLook: { character: "shiba" } as MascotLook,
  messages: [],
  tasks: [],
} as unknown as Bot;

const temporarySession: RemoteSessionView = {
  id: "8f2a0c1d2e3f",
  code: "TP2T2G",
  state: "connected",
  os: "windows",
  elevated: false,
  endAt: "2026-11-01T20:00:00.000Z",
  hostname: "Laptop-Guest",
  user: "demo\\user",
  suggestions: [],
};

const pickerItems: ScreenPickerItem[] = [
  { key: "server", label: t("orgComputer.choice.cloud"), technical: t("orgComputer.choice.cloud"), icon: Server, here: true, dot: "online" },
  { key: "desktop:d1", label: "MacBook de Demo", technical: "DemoMBP.local", icon: Laptop, dot: "online" },
  { key: hostPlaceKey(HOST), label: "PC-A", technical: "PC-A", icon: Monitor, dot: "asleep", hostAttached: true },
  { key: hostPlaceKey(OTHER), label: "Mac-Lab", technical: "Mac-Lab", icon: Monitor, dot: "asleep", hostAttached: false },
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

function PlaceDropdown({ open, rename, hostMenu }: { open: boolean; rename?: boolean; hostMenu?: boolean }) {
  const [chosen, setChosen] = useState(rename ? "desktop:d1" : "server");
  useEffect(() => {
    if (!open && !rename && !hostMenu) return;
    const timer = window.setTimeout(() => {
      const button = document.querySelector<HTMLButtonElement>("[data-gallery-sample='place-dropdown'] [data-computer-picker-button]");
      button?.click();
      if (rename) {
        window.setTimeout(() => {
          const row = document.querySelector<HTMLElement>("[data-gallery-sample='place-dropdown'] [data-computer-choice='desktop:d1']");
          row?.querySelector<HTMLButtonElement>("[data-computer-place-menu], [data-computer-rename]")?.click();
        }, 120);
      }
      if (hostMenu) {
        window.setTimeout(() => {
          const row = document.querySelector<HTMLElement>(`[data-gallery-sample='place-dropdown'] [data-computer-choice='${hostPlaceKey(OTHER)}']`);
          row?.querySelector<HTMLButtonElement>("[data-computer-place-menu]")?.click();
        }, 120);
      }
    }, 80);
    return () => window.clearTimeout(timer);
  }, [open, rename, hostMenu]);
  return (
    <div data-gallery-computer="" className="flex flex-col gap-3">
      <ScreenPicker
        items={pickerItems}
        chosen={chosen}
        onPick={setChosen}
        onRename={() => {}}
        onHostAction={() => {}}
      />
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

function DetailsSamples() {
  return (
    <>
      <Section name="details-active" title="Details (active temporary session)">
        <div data-gallery-details="" className="flex flex-col gap-3">
          <RemoteSessionsPanel
            botId={bot.id}
            rows={[temporarySession]}
            confirmId={null}
            error={null}
            onTakeControl={() => {}}
            onClose={() => {}}
          />
          <p className="rounded-lg border border-hairline/40 bg-raised/30 px-3 py-2 text-[13px] text-ink-secondary">Routines</p>
        </div>
      </Section>
      <Section name="details-clean" title="Details (no temporary session)">
        <div data-gallery-details="" className="flex flex-col gap-3 text-[13px] text-ink-secondary">
          <p data-gallery-no-remote-sessions="">{t("botPanel.tab.details")}</p>
          <p className="rounded-lg border border-hairline/40 bg-raised/30 px-3 py-2">Suggestions</p>
          <p className="rounded-lg border border-hairline/40 bg-raised/30 px-3 py-2">Routines</p>
        </div>
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
  if (view === "details") {
    return (
      <div className="flex min-h-screen flex-wrap items-start gap-6 bg-app p-5 text-ink">
        <DetailsSamples />
      </div>
    );
  }
  if (view === "attach") {
    return (
      <div className="flex min-h-screen flex-wrap items-start gap-6 bg-app p-5 text-ink">
        <Section name="place-dropdown" title="Attach from place menu">
          <PlaceDropdown open hostMenu />
        </Section>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen flex-wrap items-start gap-6 bg-app p-5 text-ink">
      <Section name="place-dropdown" title="Computer place dropdown">
        <PlaceDropdown open={open} />
      </Section>
      <DetailsSamples />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
