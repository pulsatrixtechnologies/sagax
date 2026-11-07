/** Isolated gallery for headless screenshots that put the real bot panel
 * (BotSettingsDialog) beside the real group panel (GroupPanel), so the two
 * right panels read as one design (2026-10-21; tabs redone 2026-11-03: the
 * group has the bot's Details, a Members tab with the lead on a bot's row and
 * Advanced folded, Library and Computer). Synthetic data only, the server
 * answered by a fetch stub. Not shipped in the app.
 * ?skin=<id>&lang=<code>&name=<group name> */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { loadLocale, t } from "../lib/i18n";
import { setShowSuggestions } from "../lib/panel-visibility";
import { BotEditorStore, initialState, type Bot, type Group } from "../state/store";
import { BotSettingsDialog } from "../components/BotSettingsDialog";
import { GroupPanel, PanelSection } from "../components/GroupPanel";
import { ChannelMembers } from "../components/ChannelMembers";
import { groupLeadBotId, leadResponder } from "../lib/group-panel";
import type { Routine } from "../../shared/routines";
import type { BotActivityItem } from "../../shared/bot-activity";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.8.28", __BASE_VERSION__: "0.26.0" });

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
setShowSuggestions(true);

const NOW = Date.now();
const bot = (id: string, name: string, color: string, character: string, title = ""): Bot =>
  ({ id, threadId: `t-${id}`, name, title, description: "", notifications: true, color, unread: false, mascotLook: { character }, messages: [], tasks: [], computer: "local", modelSelection: { instanceId: "x", model: "x" } }) as unknown as Bot;

const osprey = bot("osprey", params.get("botName") ?? "Osprey", params.get("botColor") ?? "green", "shiba", params.get("botTitle") ?? "Chef d'équipe");
const members = [osprey, bot("wren", "Wren", "purple", "cat"), bot("heron", "Heron", "teal", "fox")];

const routine = (id: string, name: string, extra: Partial<Routine>): Routine => ({
  id, name, prompt: "Faire le point", target: "bot", botId: "osprey", runOn: "maus", enabled: true,
  schedule: { type: "cron", expression: "0 9 * * 1-5", timeZone: "America/Toronto" }, durationMinutes: 30, nextRunAt: NOW + 3_600_000, createdAt: 1, updatedAt: 1,
  ...extra,
} as Routine);

const routines = [
  routine("r-goal", "Revue hebdomadaire des opérations", { target: "room-goal", groupId: "ops", schedule: { type: "cron", expression: "0 9 * * 1", timeZone: "America/Toronto" } }),
  routine("r-digest", "Résumé du matin dans le groupe", { botId: "wren", resultsThreadId: "t-ops" }),
  routine("r-own", "Tri de la boîte de réception", {}),
];

const activity: BotActivityItem = {
  id: "thread:t-osprey", kind: "session", botId: "osprey", botName: "Osprey", title: "Corriger le script de sauvegarde",
  status: "running", startedAt: NOW - 95_000, updatedAt: NOW, threadId: "t-osprey", coding: true, childCount: 0,
  code: { folder: "/srv/ops", branch: "fix/backup", pullRequests: [], branches: [], commits: [] },
} as unknown as BotActivityItem;

const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
window.fetch = ((input: RequestInfo | URL) => {
  const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (/\/api\/bots\/osprey\/task-list/.test(url)) {
    return json({ tasks: [
      { id: "k1", botId: "osprey", threadId: "t-ops", title: "Confirmer la fenêtre de maintenance", state: "waiting", note: "Il faut ton accord pour jeudi soir.", createdAt: NOW - 7_200_000, updatedAt: NOW - 1_800_000 },
      { id: "k2", botId: "osprey", threadId: "t-ops", title: "Préparer la liste des postes à mettre à jour", state: "doing", createdAt: NOW - 3_600_000, updatedAt: NOW - 600_000 },
      { id: "k3", botId: "osprey", threadId: "t-osprey", title: "Tâche d'une autre conversation", state: "doing", createdAt: NOW, updatedAt: NOW },
    ] });
  }
  if (/\/api\/bots\/[^/]+\/task-list/.test(url)) return json({ tasks: [] });
  if (/\/api\/bots\/osprey\/activity/.test(url)) return json({ items: [activity], subagents: [], launchedAgents: [] });
  if (/\/api\/bots\/[^/]+\/activity/.test(url)) return json({ items: [], subagents: [], launchedAgents: [] });
  if (/\/api\/bots\/[^/]+\/overview/.test(url)) return json({ setup: [] });
  if (/\/api\/threads\/t-ops\/files/.test(url)) {
    return json({ files: [
      { id: "a".repeat(24), name: "inventaire-postes.xlsx", source: "upload", path: "inventaire-postes.xlsx", size: 18_000, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", messageId: "m1", at: NOW - 600_000, available: true },
      { id: "b".repeat(24), name: "plan-maintenance.md", source: "written", path: "/srv/ops/plan-maintenance.md", size: 2_400, mime: "text/markdown", messageId: "m2", at: NOW - 86_400_000 * 9, available: true },
    ] });
  }
  if (/\/api\/threads\/[^/]+\/files/.test(url)) return json({ files: [] });
  if (/\/api\/groups\/ops\/memory/.test(url)) {
    return json({ enabled: true, canEdit: true, text: "- Maintenance le jeudi soir\n- Les postes du siège passent en premier\n", hash: "h",
      capacity: { lines: 2, bytes: 80, maxLines: 200, maxBytes: 24_000, loadedLines: 2, loadedBytes: 80, truncated: false, hash: "h" } });
  }
  if (url.includes("/api/artifacts")) return json({ artifacts: [] });
  if (url.includes("/api/pages")) return json({ pages: [] });
  return json({});
}) as typeof fetch;
(window as unknown as { EventSource: unknown }).EventSource = class { close() {} addEventListener() {} removeEventListener() {} onmessage = null; onerror = null; onopen = null; readyState = 0; };

const baseGroup = {
  // ?name= gives the group a long name, to check its title keeps the panel's margin.
  id: "ops", threadId: "t-ops", name: params.get("name") ?? "Opérations", bulletin: "Restez concis.",
  memberIds: members.map((m) => m.id), humanIds: ["kestrel@example.test"], messages: [], createdAt: 1, unread: false,
  defaultResponder: { kind: "member", botId: "osprey" },
} as unknown as Group;

function Parity() {
  const [group, setGroup] = useState(baseGroup);
  const store = {
    state: { ...initialState, bots: members, groups: [group], routines, routineRuns: [], routinesLoadState: "ready", selectedId: "osprey", settingsOpen: true, config: null,
      instances: [{ instanceId: "x", displayName: "Fixture", engineId: "fixture", models: { options: [{ id: "x", label: "Fixture" }] }, snapshot: { authenticated: true, installed: true } }] },
    dispatch: (action: { type: string; patch?: Partial<Group> }) => { if (action.type === "patchGroup" && action.patch) setGroup((current) => ({ ...current, ...action.patch })); },
    flushBotPatches: (id: string) => Promise.resolve(members.find((m) => m.id === id)),
  } as never;
  const lead = groupLeadBotId(group, members);
  return (
    <BotEditorStore value={store}>
      <div className="flex min-h-screen bg-raised text-ink" data-parity-row>
        <div className="flex flex-col">
          <span className="px-3 py-1 text-[11px] uppercase tracking-wide text-ink-tertiary">Bot (référence)</span>
          <div className="relative flex h-[1000px] w-[380px]" data-ref-bot><BotSettingsDialog bot={osprey} /></div>
        </div>
        <div className="flex flex-col">
          <span className="px-3 py-1 text-[11px] uppercase tracking-wide text-ink-tertiary">Group</span>
          <div className="relative flex h-[1000px] w-[380px]" data-ref-group>
            <GroupPanel
              group={group}
              members={members}
              canEdit
              canAddBot
              onLeave={() => {}}
              roster={
                <>
                  <PanelSection title={t("groupPanel.people")}>
                    <ChannelMembers part="humans" humans={[{ id: "kestrel@example.test", label: "Kestrel" }]} bots={[]} canAddHuman canAddBot={false} onAddHuman={() => {}} />
                  </PanelSection>
                  <PanelSection title={t("sidebar.section.bots")}>
                    <ChannelMembers
                      part="bots"
                      humans={[]}
                      bots={members.map((m) => ({ id: m.id, name: m.name, title: m.title, color: m.color, removable: true }))}
                      canAddHuman={false}
                      canAddBot
                      onRemoveBot={() => {}}
                      onAddBot={() => {}}
                      leadBotId={lead}
                      onSetLead={(id) => setGroup((current) => ({ ...current, defaultResponder: leadResponder(current, members, id) }))}
                    />
                  </PanelSection>
                </>
              }
              advanced={
                <>
                  <PanelSection title={t("room.responder.aria")}><div className="rounded-xl bg-card px-3 py-2 text-[13px] text-ink">{t("room.responder.leadOption", { name: members.find((m) => m.id === lead)?.name ?? "" })}</div></PanelSection>
                  <PanelSection title={t("room.folder.title")}><div className="rounded-xl bg-card px-3 py-2 text-[13px] text-ink-secondary">/srv/ops</div></PanelSection>
                  <button type="button" className="self-start rounded-lg bg-raised px-3 py-2 text-[13px] text-ink">{t("room.members.manage")}</button>
                </>
              }
            />
          </div>
        </div>
      </div>
    </BotEditorStore>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Parity />
  </StrictMode>,
);
