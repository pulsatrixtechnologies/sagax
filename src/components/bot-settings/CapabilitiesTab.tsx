// The one resolved list of what a bot receives on top of its engine
// (GET /api/bots/:id/capabilities, shared/capabilities.ts), read, never
// rebuilt here. Shown in Plugins > Installed for a bot, no longer as a bot
// panel tab (JC, 2026-11-01). One line per capability: its readable name,
// form, source, scope and state; a line opens in place on its detail. Then
// "What <bot> receives (engine: X)" with the prompt index's cap when it cuts
// (#1748). Never an id on screen.
import { useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Copy, LoaderCircle, Plus, RotateCcw, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useCopyFeedback } from "@/lib/copy-text";
import {
  capabilityName,
  formWord,
  indexCut,
  kilobytes,
  orderedCapabilities,
  reasonText,
  receivedGroups,
  receiptWords,
  scopeWord,
  stateTone,
  stateWord,
  type BotCapabilities,
  type Capability,
} from "@/lib/capabilities";
import { Switch } from "../SettingsPrimitives";

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
            {index.incomplete ? t("capabilities.received.indexPartial") : items.some((item) => item.promptIndex) ? t("capabilities.received.capabilityCut", { omitted: index.omitted }) : t("capabilities.received.indexCut", { omitted: index.omitted, kb: kilobytes(index.maxBytes), max: index.maxSkills })}
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
          {item.promptIndex && <Detail label={t("capabilities.detail.promptBudget")} value={t("capabilities.detail.promptBudgetValue", { count: item.promptIndex.skills, max: item.promptIndex.maxSkills, kb: kilobytes(item.promptIndex.bytes), maxKb: kilobytes(item.promptIndex.maxBytes), omitted: item.promptIndex.omitted })} />}
          {item.source.pack && <PackDetail digest={item.source.pack} version={item.source.version} />}
          {item.updateAvailable && <Detail label={t("capabilities.detail.version")} value={t("capabilities.detail.updateOffered")} />}
          {item.installedBy && <Detail label={t("capabilities.detail.installedBy")} value={item.installedBy} />}
          {!item.canToggle && <Detail label={t("capabilities.detail.switch")} value={t(`capabilities.detail.where.${item.scope}`)} />}
        </dl>
      )}
    </li>
  );
}

/** The signed Flow pack, readable: never its digest as text (no identifier
 * on screen). The digest stays behind the tooltip and the Copy action. */
export function packWords(version: string | undefined): string {
  return version ? t("capabilities.detail.packValue", { version }) : t("capabilities.detail.packValueNoVersion");
}

function PackDetail({ digest, version }: { digest: string; version?: string }) {
  const { state, copy } = useCopyFeedback(digest);
  const label = t(state === "copied" ? "capabilities.detail.packCopied" : state === "failed" ? "capabilities.detail.packCopyFailed" : "capabilities.detail.packCopy");
  return (
    <div className="contents" data-capability-pack="">
      <dt className="text-ink-secondary">{t("capabilities.detail.pack")}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 text-ink">
        <span className="min-w-0 break-words" title={digest}>{packWords(version)}</span>
        <button type="button" onClick={copy} aria-label={label} title={label} data-capability-pack-copy=""
          className="shrink-0 rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
          {state === "copied" ? <Check size={12} className="text-success" aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
        </button>
      </dd>
    </div>
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
