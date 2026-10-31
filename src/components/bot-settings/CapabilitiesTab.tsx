// Bot panel > Capabilities (lot 1b, 2026-10-30): the one resolved list of
// what this bot receives on top of its engine (GET /api/bots/:id/capabilities,
// shared/capabilities.ts), read, never rebuilt here. One line per
// capability, every form: its readable name, its form and source, its scope
// (this bot, me, organization, everyone, engine account) and its state; a
// switch only where `canToggle` says the person looking may change it, which
// calls the route that already keeps that switch (a bot plugin's enabled, a
// skill's enable with its review, the bot's own list of servers, the bot's
// Perspicax Roles). A line opens in place on its detail (what it brings, why
// it is off, what the engine gets, who installed it). Then "What <bot>
// receives (engine: X)": skills and commands, agents, servers, not served,
// with the prompt index's cap when it cuts (#1748). "Add" opens Capabilities
// in this bot's scope. Never an id on screen.
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, LoaderCircle, Plus, RotateCcw, TriangleAlert } from "lucide-react";

import { api, useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  botPluginKey,
  capabilityName,
  formWord,
  indexCut,
  installationServerName,
  kilobytes,
  orderedCapabilities,
  personalPluginKey,
  reasonText,
  receivedGroups,
  receiptWords,
  roleProfileId,
  scopeWord,
  skillName,
  stateTone,
  stateWord,
  useBotCapabilities,
  type BotCapabilities,
  type Capability,
} from "@/lib/capabilities";
import { PERSONAL_PLUGIN_TARGET, setPluginEnabled } from "@/lib/my-connections";
import { loadMcpServers } from "@/lib/mcp-servers";
import { Switch } from "../SettingsPrimitives";
import { botServersAfter } from "../plugins/BotsForView";
import { openBotPlugins } from "./LibraryTab";
import { SkillReviewDialog, useManagedSkills } from "./SkillsSection";
import { readableError } from "@/lib/plain-error";

export function CapabilitiesTab({ bot }: { bot: Bot }) {
  const { dispatch, flushBotPatches } = useStore();
  // a switch elsewhere (the editor's servers, a plugin page) reads it again
  const revision = JSON.stringify([bot.mcpServers ?? null, bot.computer ?? null]);
  const list = useBotCapabilities(bot.id, { revision });
  const skills = useManagedSkills(bot);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await work();
      await list.reload();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(null);
    }
  };

  const toggle = (item: Capability, next: boolean) => {
    const personal = personalPluginKey(item);
    if (personal) return void run(item.key, () => setPluginEnabled(PERSONAL_PLUGIN_TARGET, personal, next));
    const plugin = botPluginKey(item);
    if (plugin) return void run(item.key, () => setPluginEnabled(bot.id, plugin, next));
    const server = installationServerName(item);
    if (server) {
      return void run(item.key, async () => {
        const servers = await loadMcpServers();
        const enabled = servers.filter((entry) => entry.enabled).map((entry) => entry.name);
        dispatch({ type: "updateBot", botId: bot.id, patch: { mcpServers: botServersAfter(bot.mcpServers, enabled, [server], next) } });
        // Read after the shared patch queue confirms the server state.
        await flushBotPatches(bot.id);
      });
    }
    const role = roleProfileId(item);
    if (role) {
      return void run(item.key, async () => {
        const current = await api<{ selected?: Array<{ id: string }> }>(`/api/bots/${encodeURIComponent(bot.id)}/perspicax`);
        const ids = (current.selected ?? []).map((profile) => profile.id);
        const profiles = next ? [...new Set([...ids, role])] : ids.filter((id) => id !== role);
        await api(`/api/bots/${encodeURIComponent(bot.id)}/perspicax`, { method: "PUT", body: JSON.stringify({ profiles }) });
      });
    }
    const name = skillName(item);
    if (name && item.scope === "me") return void run(item.key, () => api(`/api/me/skills-library/${encodeURIComponent(name)}`, {
      method: "PATCH", body: JSON.stringify({ enabled: next }),
    }));
    const skill = name ? skills.skills.find((entry) => entry.name === name) : undefined;
    // switching a skill on goes through its review (SkillReviewDialog)
    if (skill) return void run(item.key, () => skills.toggle(skill));
  };
  // a skill switched on after its review: the list follows
  useEffect(() => {
    if (!skills.working && !skills.reviewing) void list.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills.skills]);

  const switchable = (item: Capability): boolean => {
    if (!item.canToggle) return false;
    if (personalPluginKey(item) || botPluginKey(item) || installationServerName(item) || roleProfileId(item)) return true;
    const name = skillName(item);
    if (name && item.scope === "me") return true;
    return Boolean(name && skills.skills.some((entry) => entry.name === name));
  };

  return (
    <>
      <CapabilitiesBody
        botName={bot.name}
        data={list.data}
        error={list.data ? null : list.error}
        actionError={error ?? (skills.error || null)}
        busy={busy ?? (skills.working ? `skill:${skills.working}` : null)}
        switchable={switchable}
        onToggle={toggle}
        onRetry={() => void list.reload()}
        onAdd={() => openBotPlugins(dispatch, bot.id)}
      />
      {skills.reviewing && (
        <SkillReviewDialog
          skill={skills.reviewing.skill}
          text={skills.reviewing.text}
          error={skills.error}
          working={Boolean(skills.working)}
          onCancel={() => skills.setReviewing(null)}
          onEnable={() => void skills.enableReviewed().then(() => list.reload())}
        />
      )}
    </>
  );
}

const CHIP = "shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-[15px]";
const TONE: Record<"good" | "accent" | "warn" | "muted", string> = {
  good: "bg-success/10 text-success",
  accent: "bg-accent/12 text-accent-text",
  warn: "bg-warning/12 text-warning",
  muted: "bg-ink/[0.06] text-ink-secondary",
};

/** Everything the tab shows, given the loaded list (tests and the gallery
 * render it). */
export function CapabilitiesBody({ botName, data, error = null, actionError = null, busy = null, switchable = (item) => item.canToggle, onToggle = () => {}, onRetry = () => {}, onAdd, openAll = false, rowActions, showReceived = true }: {
  botName: string;
  /** null while the first load is in flight */
  data: BotCapabilities | null;
  error?: string | null;
  actionError?: string | null;
  /** the key of the capability whose switch is being written */
  busy?: string | null;
  switchable?: (item: Capability) => boolean;
  onToggle?: (item: Capability, next: boolean) => void;
  onRetry?: () => void;
  /** "Add": Capabilities in this bot's scope */
  onAdd?: () => void;
  /** tests and captures: every line open on its detail */
  openAll?: boolean;
  /** Installed keeps its existing detail, update and remove actions. */
  rowActions?: (item: Capability) => ReactNode;
  showReceived?: boolean;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  if (!data) {
    return (
      <div className="flex flex-col gap-4 px-4 pb-6 pt-2" data-capabilities="">
        {error ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-[13px] text-ink-secondary">
            <span role="alert">{t("capabilities.panel.error")}</span>
            <button type="button" onClick={onRetry} className="flex items-center gap-1.5 rounded-md border border-hairline-weak px-2.5 py-1 text-[12px] text-ink hover:bg-hover">
              <RotateCcw size={12} aria-hidden="true" /> {t("chat.retry")}
            </button>
          </div>
        ) : (
          <div role="status" className="flex items-center justify-center gap-2 py-10 text-[13px] text-ink-secondary">
            <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> {t("capabilities.panel.loading")}
          </div>
        )}
      </div>
    );
  }
  const items = orderedCapabilities(data.items);
  const activeCount = items.filter((item) => item.state === "on" || item.state === "imposed").length;
  const groups = receivedGroups(items);
  const index = data.promptIndex;
  const cut = indexCut(index);
  const flip = (key: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 pt-2" data-capabilities="">
      {actionError && <p role="alert" className="text-[12px] text-danger">{actionError}</p>}
      <section className="flex flex-col gap-1.5" data-capabilities-list="">
        <div className="flex items-center gap-2 px-0.5">
          <h3 className="flex-1 text-[12px] font-medium text-ink-secondary">
            {t("capabilities.panel.title")}
            <span className="text-ink-tertiary"> · {t(activeCount === 1 ? "capabilities.panel.activeOne" : "capabilities.panel.activeMany", { count: activeCount })}</span>
          </h3>
          {onAdd && (
            <button type="button" data-capabilities-add="" onClick={onAdd}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-accent-text hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
              <Plus size={13} aria-hidden="true" /> {t("capabilities.panel.add")}
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <div data-capabilities-empty="" className="rounded-2xl border border-hairline-weak bg-elevated px-3 py-4 text-center text-[12.5px] text-ink-secondary">
            {t("capabilities.panel.empty", { name: botName })}
          </div>
        ) : (
          <ul className="flex flex-col overflow-hidden rounded-2xl border border-hairline-weak bg-elevated">
            {items.map((item) => (
              <CapabilityRow
                key={item.key}
                item={item}
                expanded={openAll || open.has(item.key)}
                onExpand={() => flip(item.key)}
                switchable={switchable(item)}
                busy={busy === item.key}
                locked={busy !== null}
                onToggle={(next) => onToggle(item, next)}
                actions={rowActions?.(item)}
              />
            ))}
          </ul>
        )}
      </section>

      {showReceived && <section className="flex flex-col gap-1.5" data-capabilities-received="">
        <h3 className="px-0.5 text-[12px] font-medium text-ink-secondary">
          {t("capabilities.received.title", { name: botName, engine: data.engine.label })}
        </h3>
        <dl className="grid grid-cols-[minmax(88px,auto)_1fr] gap-x-3 gap-y-2 rounded-2xl border border-hairline-weak bg-elevated px-3 py-2.5 text-[12.5px] leading-[18px]">
          <ReceivedRow id="skills" label={t("capabilities.received.skills")}>
            {groups.native.length === 0 && groups.prompt.length === 0 ? <None engine={data.engine.label} /> : (
              <>
                {groups.native.length > 0 && <span className="block">{groups.native.join(", ")}<span className="text-ink-secondary">{t("capabilities.engines.colon")}{t("capabilities.received.native")}</span></span>}
                {groups.prompt.length > 0 && (
                  <span className="block">
                    {groups.prompt.join(", ")}
                    <span className="text-ink-secondary">{t("capabilities.engines.colon")}{t("capabilities.received.prompt")}</span>
                    {index && <span className="text-ink-tertiary"> {t("capabilities.received.indexCap", { kb: kilobytes(index.maxBytes), max: index.maxSkills })}</span>}
                  </span>
                )}
              </>
            )}
          </ReceivedRow>
          <ReceivedRow id="agents" label={t("capabilities.received.agents")}>
            {groups.agents.length ? groups.agents.join(", ") : <None engine={data.engine.label} />}
          </ReceivedRow>
          <ReceivedRow id="servers" label={t("capabilities.received.servers")}>
            {groups.servers.length ? groups.servers.join(", ") : <None engine={data.engine.label} />}
          </ReceivedRow>
          {groups.notServed.length > 0 && (
            <ReceivedRow id="not-served" label={t("capabilities.received.notServed")}>
              {groups.notServed.map((entry) => `${entry.name} (${entry.why})`).join(", ")}
            </ReceivedRow>
          )}
        </dl>
        {cut && index && (
          <p role="note" data-capabilities-index-cut="" className="flex items-start gap-1.5 rounded-xl bg-warning/10 px-3 py-2 text-[12px] leading-[17px] text-warning">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            {index.incomplete ? t("capabilities.received.indexPartial") : t("capabilities.received.indexCut", { omitted: index.omitted, kb: kilobytes(index.maxBytes), max: index.maxSkills })}
          </p>
        )}
      </section>}
    </div>
  );
}

function None({ engine }: { engine: string }) {
  return <span className="text-ink-secondary">{t("capabilities.received.none", { engine })}</span>;
}

function ReceivedRow({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="contents" data-capabilities-received-row={id}>
      <dt className="font-medium text-ink">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

/** One capability: name, form and source, scope, state, its switch; open,
 * its detail. */
function CapabilityRow({ item, expanded, onExpand, switchable, busy, locked, onToggle, actions }: {
  item: Capability;
  expanded: boolean;
  onExpand: () => void;
  switchable: boolean;
  busy: boolean;
  locked: boolean;
  onToggle: (next: boolean) => void;
  actions?: ReactNode;
}) {
  const name = capabilityName(item);
  const tone = stateTone(item.state);
  const source = [formWord(item.form), item.source.label, item.source.version ? `v${item.source.version}` : null].filter(Boolean).join(" · ");
  const reason = reasonText(item.reason);
  const brings = item.brings;
  return (
    <li data-capability={item.form} data-capability-scope={item.scope} data-capability-state={item.state} className="border-b border-hairline-weak last:border-b-0">
      <div className="flex min-w-0 items-center gap-2 px-2.5 py-1.5">
        <button type="button" aria-expanded={expanded} onClick={onExpand}
          aria-label={t("capabilities.row.openAria", { name })}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
          {expanded ? <ChevronDown size={13} className="shrink-0 text-ink-tertiary" aria-hidden="true" /> : <ChevronRight size={13} className="shrink-0 text-ink-tertiary" aria-hidden="true" />}
          <span className="min-w-0 flex-1">
            <span className="block break-words text-[13px] text-ink" title={name}>{name}</span>
            <span className="block truncate text-[11.5px] text-ink-secondary" title={source}>{source}</span>
          </span>
        </button>
        <span className="flex max-w-[50%] shrink-0 flex-wrap justify-end gap-1">
          <span className={cn(CHIP, TONE.muted)} data-capability-scope-chip="">{scopeWord(item.scope)}</span>
          {tone && <span className={cn(CHIP, TONE[tone])} data-capability-state-chip="" title={reason ?? undefined}>{stateWord(item.state)}</span>}
        </span>
        {switchable ? (
          busy ? <LoaderCircle size={14} className="mx-3 shrink-0 animate-spin text-ink-secondary motion-reduce:animate-none" aria-hidden="true" /> : (
            <Switch checked={item.enabled} disabled={locked} onClick={() => onToggle(!item.enabled)}
              aria-label={t(item.enabled ? "capabilities.row.offAria" : "capabilities.row.onAria", { name })} />
          )
        ) : null}
        {actions}
      </div>
      {expanded && (
        <dl data-capability-detail="" className="grid grid-cols-[minmax(80px,auto)_1fr] gap-x-3 gap-y-1 px-8 pb-2.5 text-[12px] leading-[17px]">
          {item.description && <Detail label={t("capabilities.detail.about")} value={item.description} />}
          <Detail label={t("capabilities.detail.state")} value={reason ? `${stateWord(item.state)} · ${reason}` : stateWord(item.state)} />
          {brings && brings.skills.length > 0 && <Detail label={t("capabilities.detail.skills")} value={brings.skills.join(", ")} />}
          {brings && brings.commands.length > 0 && <Detail label={t("capabilities.detail.commands")} value={brings.commands.join(", ")} />}
          {brings && brings.agents.length > 0 && <Detail label={t("capabilities.detail.agents")} value={brings.agents.join(", ")} />}
          {brings && brings.mcpServers.length > 0 && <Detail label={t("capabilities.detail.servers")} value={brings.mcpServers.join(", ")} />}
          <Detail label={t("capabilities.detail.engine")} value={receiptWords(item.engine)} />
          {item.updateAvailable && <Detail label={t("capabilities.detail.version")} value={t("capabilities.detail.updateOffered")} />}
          {item.installedBy && <Detail label={t("capabilities.detail.installedBy")} value={item.installedBy} />}
          {!item.canToggle && <Detail label={t("capabilities.detail.switch")} value={t(`capabilities.detail.where.${item.scope}`)} />}
        </dl>
      )}
    </li>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{value}</dd>
    </div>
  );
}
