// The page's cards and rows (#2271, split from BotProfilePage for #1383):
// the grey-label card, its rows, a locked section's note, a tab's block,
// and the General tab's Channels and Bot accounts cards.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BellRing, ChevronDown, Cpu, Lock, Mail, MessageCircle, Plug } from "lucide-react";

import { useStore, type Bot, type BotSettingsSection } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import { useBotInboundMailState } from "@/lib/bot-inbound-mail";
import { useReachMe } from "@/lib/reach-me";
import { loadMessagesSetup } from "@/lib/mac-messages-setup";
import { capabilityName, orderedCapabilities, stateWord, useBotCapabilities } from "@/lib/capabilities";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import type { BotProfileTab, PersonaCategory } from "@/lib/persona-sections";
import type { MessagesSetupStatus } from "../../../../shared/mac-messages-setup";
import { AnchoredPopover, useAnchoredDismissRoot } from "../../AnchoredPopover";
import { PILL } from "../../SettingsPrimitives";
import { BOT_SECTIONS } from "../../bot-settings/sections";
import { SlackSection } from "../../bot-settings/SlackSection";
import { BotEmailAddress } from "../../bot-settings/BotEmailAddress";
import { BotReachMe } from "../../bot-settings/BotReachMe";

const ENTRY = new Map(BOT_SECTIONS.map((entry) => [entry.id, entry]));

/** A section's name, as the editor's rail named it. */
export function sectionLabel(id: BotSettingsSection): string {
  const entry = ENTRY.get(id);
  if (!entry) return id;
  return entry.labelKey ? t(entry.labelKey) : entry.label;
}

/** The tabs' names (V6, #2612; Appearance its own tab, JC 2026-11-08). */
export const TAB_LABEL: Record<BotProfileTab, LocaleKey> = {
  general: "botProfile.tab.general",
  appearance: "botProfile.tab.appearance",
  knowledge: "botProfile.tab.knowledge",
  stats: "botProfile.tab.stats",
};

const REACH_LABEL: Record<string, LocaleKey> = {
  push: "botPanel.reachMe.push.label",
  sms: "botPanel.reachMe.sms.label",
  teams: "botPanel.reachMe.teams.label",
  telegram: "botPanel.reachMe.telegram.label",
  whatsapp: "botPanel.reachMe.whatsapp.label",
};

export type Channel = "slack" | "email" | "reachMe" | "messages";

/** The row of a locked section's card: why this viewer may only read it. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <p role="note" data-persona-locked="" aria-label={t("persona.lockedBadge")} className="m-0 flex min-h-[44px] items-center gap-3 px-4 py-2 text-[14px] leading-5 text-ink-secondary">
      <Lock strokeWidth={1.5} aria-hidden="true" className="size-5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** One row of a card: icon, name, state under it, an action on the right,
 * and what the action unfolds under the row. */
export function CardRow({ icon, label, state, action, children, rowId }: {
  icon: ReactNode;
  label: string;
  state?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  rowId: string;
}) {
  return (
    <div data-bot-profile-row={rowId} className="flex flex-col">
      <div className={cn("flex items-center gap-3 px-4", action ? "min-h-[56px] py-2.5" : "min-h-[44px] py-2")}>
        <span className="flex size-5 shrink-0 items-center justify-center text-ink-secondary [&>svg]:size-5" aria-hidden="true">{icon}</span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[14px] leading-5 text-ink">{label}</span>
          {state !== undefined && state !== null && <span data-bot-profile-state="" className="truncate text-[12px] leading-4 text-ink-secondary">{state}</span>}
        </div>
        {action}
      </div>
      {children && <div className="px-4 pb-3 pt-1">{children}</div>}
    </div>
  );
}

/** A section of a tab's page: the same body as the bot panel's, whose
 * cards carry their own grey labels (the page adds no heading of its own).
 * A section this viewer may only read says so in its body (a Note). */
export function Block({ id, locked, children }: { id: PersonaCategory; locked: boolean; children: ReactNode }) {
  return (
    <section
      aria-label={sectionLabel(id)}
      data-bot-profile-section={id}
      data-persona-section={id}
      data-bot-profile-locked={locked ? "" : undefined}
      data-open=""
      className="flex min-w-0 flex-col gap-6"
    >
      {children}
    </section>
  );
}

/** A card of the page: a grey label (and its accessory) over a borderless
 * surface a step lighter than the page (Grok Bot). */
export function ProfileCard({ title, groupId, accessory, children }: {
  title: string;
  groupId: string;
  accessory?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-settings-group={groupId} className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-1.5 px-1">
        <h3 id={headingId} className="shrink-0 text-[13px] font-normal leading-[18px] text-ink-secondary">{title}</h3>
        {accessory}
      </div>
      <div className="flex flex-col rounded-2xl bg-card py-1">{children}</div>
    </section>
  );
}

/** Slack's own four-color mark (the lucide outline, filled). */
function SlackLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" data-slack-logo="">
      <rect x="2" y="8" width="8" height="3" rx="1.5" fill="#36C5F0" />
      <path d="M8.5 5H10V3.5A1.5 1.5 0 1 0 8.5 5" fill="#36C5F0" />
      <rect x="13" y="2" width="3" height="8" rx="1.5" fill="#2EB67D" />
      <path d="M19 8.5V10h1.5A1.5 1.5 0 1 0 19 8.5" fill="#2EB67D" />
      <rect x="14" y="13" width="8" height="3" rx="1.5" fill="#ECB22E" />
      <path d="M15.5 19H14v1.5a1.5 1.5 0 1 0 1.5-1.5" fill="#ECB22E" />
      <rect x="8" y="14" width="3" height="8" rx="1.5" fill="#E01E5A" />
      <path d="M5 15.5V14H3.5A1.5 1.5 0 1 0 5 15.5" fill="#E01E5A" />
    </svg>
  );
}

/** General > Channels, in place on the tab (#3398): where the bot can be
 * reached, each with its state and its Connect or Manage. A channel this
 * server does not offer is not drawn (Slack without its Admin link: Slack
 * as a channel is removed for now, shared/team-chat-channels.ts), and a
 * card with no channel left is not drawn. */
export function ChannelsCard({ bot, slackUrl, open, onOpen }: {
  bot: Bot;
  slackUrl: string | null | undefined;
  open: Channel | null;
  onOpen: (channel: Channel | null) => void;
}) {
  const { dispatch } = useStore();
  const [mail] = useBotInboundMailState(bot.id);
  const [reach] = useReachMe(bot.id);
  const [messages, setMessages] = useState<MessagesSetupStatus | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    loadMessagesSetup().then((status) => { if (!cancelled) setMessages(status); }, () => { if (!cancelled) setMessages(null); });
    return () => { cancelled = true; };
  }, []);

  const pill = (channel: Channel, connected: boolean) => (
    <button
      type="button"
      data-bot-profile-action={channel}
      aria-expanded={open === channel}
      onClick={() => onOpen(open === channel ? null : channel)}
      className={cn(PILL, "shrink-0")}
    >
      {open === channel ? t("botProfile.hide") : connected ? t("botProfile.manage") : t("botProfile.connect")}
    </button>
  );

  const reachOn = (reach?.settings.channels ?? []).map((id) => (REACH_LABEL[id] ? t(REACH_LABEL[id]!) : null)).filter((label): label is string => label !== null);
  const messagesHere = messages ? messages.available && messages.onThisMac : false;

  // An option the context makes impossible is not rendered (hiddenWhenUnavailable).
  const rows: ReactNode[] = [];
  if (slackUrl) {
    rows.push(
      <CardRow
        key="slack"
        rowId="slack"
        icon={<SlackLogo />}
        label={t("botProfile.channel.slack")}
        state={t("botProfile.state.managedInAdmin")}
        action={pill("slack", true)}
      >
        {open === "slack" ? <SlackSection managementUrl={slackUrl} /> : null}
      </CardRow>,
    );
  }
  if (mail === null || mail.available) {
    rows.push(
      <CardRow
        key="email"
        rowId="email"
        icon={<Mail />}
        label={t("botProfile.channel.email")}
        state={mail === null ? null : mail.address ?? t("botProfile.state.noAddress")}
        action={mail?.address ? pill("email", true) : undefined}
      >
        {open === "email" && mail?.address ? <BotEmailAddress botId={bot.id} /> : null}
      </CardRow>,
    );
  }
  rows.push(
    <CardRow
      key="reachMe"
      rowId="reachMe"
      icon={<BellRing />}
      label={t("botPanel.reachMe.label")}
      state={reach === null ? null : reachOn.length > 0 ? reachOn.join(", ") : t("botProfile.state.notConnected")}
      action={reach === null ? undefined : pill("reachMe", reachOn.length > 0)}
    >
      {open === "reachMe" ? <BotReachMe botId={bot.id} /> : null}
    </CardRow>,
  );
  if (messages === undefined || messagesHere) {
    rows.push(
        <CardRow
          key="messages"
          rowId="messages"
          icon={<MessageCircle />}
          label={t("botProfile.channel.messages")}
          state={messages === undefined ? null : messages!.useMessages ? t("botProfile.state.on") : t("botProfile.state.notConnected")}
          action={messagesHere ? (
            <button
              type="button"
              data-bot-profile-action="messages"
              onClick={() => {
                dispatch({ type: "togglePlugins", open: true, surface: "apps" });
                window.dispatchEvent(new CustomEvent("sagax:open-mac-messages"));
              }}
              className={cn(PILL, "shrink-0")}
            >
              {messages!.useMessages ? t("botProfile.manage") : t("botProfile.connect")}
            </button>
          ) : undefined}
        />,
    );
  }
  if (rows.length === 0) return null;

  return (
    <ProfileCard title={t("botProfile.channels")} groupId="bot-profile-channels">
      {rows}
    </ProfileCard>
  );
}

/** General > Bot accounts: the bot's engine and the connectors it receives;
 * "Add" opens Connect apps for this bot. */
export function AccountsCard({ bot, onEngine }: { bot: Bot; onEngine: () => void }) {
  const { dispatch } = useStore();
  const { data, error, loading, reload } = useBotCapabilities(bot.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const dismissRoot = useAnchoredDismissRoot(anchorRef, popoverRef);
  usePopoverDismiss(menuOpen, dismissRoot, () => setMenuOpen(false));

  const connect = (surface: "apps" | "mcp") => {
    setMenuOpen(false);
    dispatch({ type: "togglePlugins", open: true, surface, botId: bot.id });
  };
  const accounts = data ? orderedCapabilities(data.items).filter((item) => item.form === "connector" || item.form === "mcp") : [];

  const add = (
    <div className="ml-auto">
      <button
        ref={anchorRef}
        type="button"
        data-bot-profile-add=""
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((value) => !value)}
        className={cn(PILL, "inline-flex items-center gap-1")}
      >
        {t("botProfile.add")} <ChevronDown size={13} aria-hidden="true" />
      </button>
      {menuOpen && (
        <AnchoredPopover
          anchorRef={anchorRef}
          popoverRef={popoverRef}
          align="end"
          role="menu"
          aria-label={t("botProfile.add")}
          className="w-[220px] rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1 text-[13px] text-ink shadow-xl"
        >
          <button type="button" role="menuitem" onClick={() => connect("apps")} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover">
            <Plug size={15} aria-hidden="true" /> {t("botProfile.add.apps")}
          </button>
          <button type="button" role="menuitem" onClick={() => connect("mcp")} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover">
            <Cpu size={15} aria-hidden="true" /> {t("botProfile.add.mcp")}
          </button>
        </AnchoredPopover>
      )}
    </div>
  );

  return (
    <ProfileCard title={t("botProfile.accounts")} groupId="bot-profile-accounts" accessory={add}>
      {error && !data ? (
        <div role="alert" data-bot-profile-accounts-error="" className="flex flex-col items-start gap-1 px-4 py-3.5">
          <span className="text-[14px] font-normal leading-5 text-ink">{t("botProfile.accounts.error")}</span>
          <span className="text-[12.5px] leading-snug text-ink-secondary">{error}</span>
          <button type="button" onClick={() => void reload()} className={cn(PILL, "mt-1")}>{t("botProfile.retry")}</button>
        </div>
      ) : !data ? (
        <div role="status" className="px-4 py-3 text-[12.5px] text-ink-secondary">{loading ? t("botProfile.accounts.loading") : null}</div>
      ) : (
        <>
          <CardRow
            rowId="engine"
            icon={<Cpu />}
            label={data.engine.label}
            state={t("botProfile.engine")}
            action={<button type="button" data-bot-profile-action="engine" onClick={onEngine} className={cn(PILL, "shrink-0")}>{t("botProfile.manage")}</button>}
          />
          {accounts.map((item, index) => (
            <CardRow key={`${item.form}-${index}`} rowId={`account-${index}`} icon={<Plug />} label={capabilityName(item)} state={stateWord(item.state)} />
          ))}
          {accounts.length === 0 && (
            <p className="px-4 pb-2 pt-1 text-[12.5px] leading-snug text-ink-secondary">{t("botProfile.accounts.empty")}</p>
          )}
        </>
      )}
    </ProfileCard>
  );
}
