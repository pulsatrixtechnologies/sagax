/** Isolated gallery for Playwright screenshots that put the bot panel's
 * header beside the group panel (src/components/GroupPanel.tsx), so the two
 * right panels can be read as one design (JC 2026-10-21). The left column is
 * the real bot-panel header (BotProfileAvatarCard, sized by #977, the name
 * pulled up, the label and the tab strip). The right column is the real
 * GroupPanel with three member bots and a members body. Not shipped in the
 * app. ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { setLocale, t } from "../lib/i18n";
import { StoreProvider, type Bot, type Group } from "../state/store";
import { BotProfileAvatarCard } from "../components/BotProfileAvatarCard";
import { InlineEditableText } from "../components/bot-settings/InlineEditableText";
import { GroupPanel, PanelSection } from "../components/GroupPanel";
import { ChannelMembers } from "../components/ChannelMembers";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");

const bot = (id: string, name: string, color: string, character: string, title = ""): Bot =>
  ({ id, threadId: `t-${id}`, name, title, description: "", notifications: true, color, unread: false, mascotLook: { character }, messages: [], tasks: [] }) as unknown as Bot;

const lead = bot("pepper", "Pepper", "green", "shiba", "Chef d'équipe");
const members = [lead, bot("juniper", "Juniper", "purple", "cat"), bot("moss", "Moss", "teal", "fox")];

const group = {
  id: "ops", threadId: "t-ops", name: "Operations", bulletin: "Restez concis.",
  memberIds: members.map((m) => m.id), humanIds: ["jc@example.test"], messages: [],
  defaultResponder: { kind: "auto" },
} as unknown as Group;

/** The real bot-panel header, the exact markup BotSettingsDialog uses. */
function BotHeader() {
  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-l-[0.5px] border-hairline-weak bg-app">
      <div className="content-topbar relative flex h-12 shrink-0 items-center justify-between px-3"><span /><span /></div>
      <div className="content-card-body flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden [&>*]:shrink-0">
        <div className="flex shrink-0 flex-col items-center px-4 pb-3">
          <BotProfileAvatarCard bot={lead} activeState="happy" mascotMotion={null} onPatch={() => {}} />
          <div className="-mt-1 flex max-w-full items-center justify-center">
            <InlineEditableText id="bot-ref-title" value={lead.name} required maxLength={60} ariaLabel={t("botPanel.name.edit")} className="text-[17px] font-medium leading-6 text-ink" />
          </div>
          <InlineEditableText value={lead.title} maxLength={60} ariaLabel={t("botPanel.label.edit")} muted className="mt-0.5 text-[12.5px] leading-4" />
          <div className="mt-4 flex max-w-full flex-wrap items-center justify-center gap-0.5">
            {["details", "library"].map((id, index) => (
              <span key={id} className={`rounded-md px-1.5 py-1 text-[13px] leading-5 ${index === 0 ? "bg-elevated-hover text-ink" : "text-ink-secondary"}`}>{t(`botPanel.tab.${id}`)}</span>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

function Parity() {
  return (
    <div className="flex min-h-screen bg-raised text-ink" data-parity-row>
      <div className="flex flex-col">
        <span className="px-3 py-1 text-[11px] uppercase tracking-wide text-ink-tertiary">Bot (référence)</span>
        <div className="relative flex-1" data-ref-bot><BotHeader /></div>
      </div>
      <div className="flex flex-col">
        <span className="px-3 py-1 text-[11px] uppercase tracking-wide text-ink-tertiary">Group</span>
        <div className="relative flex-1" data-ref-group>
          <GroupPanel
            group={group}
            members={members}
            canEdit
            details={
              <>
                <PanelSection title={t("groupPanel.people")}>
                  <ChannelMembers part="humans" humans={[{ id: "jc@example.test", label: "Jean-Christophe" }]} bots={[]} canAddHuman canAddBot={false} onAddHuman={() => {}} />
                </PanelSection>
                <PanelSection title="Bots">
                  <ChannelMembers part="bots" humans={[]} bots={members.map((m) => ({ id: m.id, name: m.name, title: m.title, color: m.color, removable: true }))} canAddHuman={false} canAddBot onRemoveBot={() => {}} onAddBot={() => {}} addBotLabel="Ajouter mon robot" />
                </PanelSection>
              </>
            }
            advanced={<PanelSection title={t("room.folder.title")}><div className="rounded-xl bg-card px-3 py-2 text-[13px] text-ink-secondary">/srv/ops</div></PanelSection>}
          />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <Parity />
    </StoreProvider>
  </StrictMode>,
);
