// Edit several bots at once (the sidebar's selection bar, Edit): the bot
// editor's own sections (Model, Shared with, Workspace, Access, Voice,
// Permissions, Perspicax Profiles), each "Do not change" until the person
// opens it. A section's real controls edit a draft bot (a scoped store and
// transport, as New bot does), so nothing is written until Apply. A value the
// bots share shows; when they differ the section says "Mixed values" with
// each bot's value behind its help. Lists are changed by Add, Remove or
// Replace with. Before Apply: one summary line; after: one result per bot,
// and Undo puts the bots back (src/lib/bulk-bot-edit.ts runs both).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, Loader2, Minus, Undo2 } from "lucide-react";

import { api, BotEditorStore, persistBotUpdate, useStore, type Bot, type BotSettingsSection } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { engineLabel, personLabel } from "@/lib/human-label";
import { placeLabelKey, type EffectivePlace } from "@/lib/place";
import { usePerspicaxOrg, type OrgDirectory } from "@/lib/perspicax-org";
import { useMcpServers } from "@/lib/mcp-servers";
import { viewerCan } from "@/lib/viewer";
import { viewerLocalBotSettings } from "@/lib/viewer-bot-overrides";
import { readableOr } from "../../shared/human-id";
import { botApprovalSetting } from "../../shared/approval-mode";
import {
  bulkOutcomeCounts,
  commonListItems,
  commonValue,
  patchFields,
  type BulkBotOutcome,
  type BulkListMode,
} from "../../shared/bulk-bot-edit";
import {
  BULK_SECTION_FIELDS,
  BULK_SECTIONS,
  bulkDraftBot,
  bulkSectionRequest,
  dirtyPatch,
  forgetBulkRun,
  lastBulkRun,
  listActive,
  listStart,
  mixedFieldsOf,
  rememberBulkRun,
  runBulkEdit,
  sectionBaseline,
  sectionFieldStates,
  sectionTouched,
  undoBulkEdit,
  type BulkBefore,
  type BulkChanges,
  type BulkSectionChange,
  type BulkSectionId,
} from "@/lib/bulk-bot-edit";
import { BOT_SECTIONS } from "./bot-settings/sections";
import { BotEditorContext } from "./bot-settings/BotEditorContext";
import { botSectionLock } from "./bot-settings/useBotSectionContent";
import { useBotSettingsDerived } from "./bot-settings/useBotSettingsDerived";
import { ModelSection } from "./bot-settings/ModelSection";
import { SharingSection } from "./bot-settings/SharingSection";
import { WorksOnSetting } from "./computer/WorksOnSetting";
import { AccessSection } from "./bot-settings/AccessSection";
import { VoiceSection } from "./bot-settings/VoiceSection";
import { PermissionsSection } from "./bot-settings/PermissionsSection";
import { PerspicaxProfileControl, perspicaxRows, type PerspicaxAnswer, type PerspicaxProfile } from "./bot-settings/PerspicaxSection";
import { DialogFrame, DialogLayer, GROUP_CARD, HelpTip, PILL, PRIMARY_PILL } from "./SettingsPrimitives";

const LIST_MODES: BulkListMode[] = ["add", "remove", "replace"];
const MODE_KEY: Record<BulkListMode, LocaleKey> = {
  add: "bulkEdit.mode.add",
  remove: "bulkEdit.mode.remove",
  replace: "bulkEdit.mode.replace",
};
const FIELD_KEY: Partial<Record<string, LocaleKey>> = {
  modelSelection: "bulkEdit.field.model",
  fallback: "bulkEdit.field.fallback",
  computer: "computer.worksOn",
  cloudBackend: "bulkEdit.field.cloudBackend",
  autoStartVps: "botPanel.access.startVps",
  browser: "botPanel.access.browser",
  cwd: "botPanel.access.folder",
  toolScope: "bulkEdit.field.tools",
  mcpAccounts: "bulkEdit.field.mcpAccounts",
  mcpServers: "connectors.tab.mcp",
  voice: "bulkEdit.field.voice",
  speakReplies: "bulkEdit.field.speakReplies",
  notifications: "botPanel.remote.notifications",
  approvalMode: "bulkEdit.field.approvalMode",
  proactiveMode: "bulkEdit.field.proactive",
  outbound: "bulkEdit.field.outbound",
  chiefOfStaff: "bulkEdit.field.primary",
  managedSections: "bulkEdit.field.managedSections",
  approvePeerComms: "bulkEdit.field.peerComms",
  peers: "bulkEdit.field.peers",
};
const APPROVAL_KEY: Record<string, LocaleKey> = {
  ask: "approvalMode.ask.chip",
  auto: "approvalMode.auto.chip",
  edits: "approvalMode.edits.chip",
  full: "approvalMode.full.chip",
  custom: "approvalMode.custom.chip",
};

function sectionLabel(id: BulkSectionId): string {
  const entry = BOT_SECTIONS.find((section) => section.id === id);
  return entry?.labelKey ? t(entry.labelKey) : entry?.label ?? id;
}

function fieldLabel(field: string, section: BulkSectionId): string {
  const key = FIELD_KEY[field];
  return key ? t(key) : sectionLabel(section);
}

/** Bot ids the dialog reads per bot (the lists it compares). */
interface PerBot {
  perspicax: Record<string, PerspicaxAnswer | null>;
}

export function BulkEditBotsDialog({ botIds, onClose, onDone }: {
  botIds: string[];
  onClose: () => void;
  /** After Apply: the selection may end. */
  onDone?: () => void;
}) {
  const parent = useStore();
  const { state, dispatch, flushBotPatches } = parent;
  const perspicaxOrg = usePerspicaxOrg();
  const { servers } = useMcpServers();
  const bots = useMemo(
    () => botIds.flatMap((id) => state.bots.filter((bot) => bot.id === id && !viewerLocalBotSettings(state.config, bot))),
    [botIds, state.bots, state.config],
  );
  const viewerId = state.config?.viewer?.principalId ?? null;
  const sections = BULK_SECTIONS.filter((id) => (id === "sharing" || id === "perspicax") ? perspicaxOrg !== null : true);

  const [changes, setChanges] = useState<BulkChanges>({});
  const changesRef = useRef(changes);
  changesRef.current = changes;
  const [opened, setOpened] = useState<BulkSectionId[]>([]);
  const [generation, setGeneration] = useState<Partial<Record<BulkSectionId, number>>>({});
  const [step, setStep] = useState<"edit" | "review" | "running" | "done">("edit");
  const [outcomes, setOutcomes] = useState<BulkBotOutcome[] | null>(null);
  const [before, setBefore] = useState<BulkBefore[]>([]);
  const [undoState, setUndoState] = useState<"idle" | "running" | "done">("idle");
  const [undoOutcomes, setUndoOutcomes] = useState<BulkBotOutcome[] | null>(null);
  const [directory, setDirectory] = useState<OrgDirectory | null>(null);
  const [perBot, setPerBot] = useState<PerBot>({ perspicax: {} });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busy = step === "running" || undoState === "running";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      // a menu or picker inside a section takes Escape first
      if (document.querySelector("[role=menu], [role=listbox]")) return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy]);

  // Shared with and Perspicax compare lists the bots hold
  useEffect(() => {
    if (!perspicaxOrg) return;
    let alive = true;
    void api<OrgDirectory>("/api/org/directory")
      .then((body) => { if (alive) setDirectory({ people: body.people ?? [], teams: body.teams ?? [] }); })
      .catch(() => { if (alive) setDirectory({ people: [], teams: [] }); });
    void Promise.all(bots.map(async (bot) => [bot.id, await api<PerspicaxAnswer>(`/api/bots/${bot.id}/perspicax`).catch(() => null)] as const))
      .then((rows) => { if (alive) setPerBot({ perspicax: Object.fromEntries(rows) }); });
    return () => { alive = false; };
    // the selection is fixed while the dialog is open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perspicaxOrg]);

  const grantLabel = useCallback((target: string) => {
    const id = target.slice(5);
    if (target.startsWith("team:")) return readableOr(directory?.teams?.find((team) => team.id === id)?.name ?? id, t("ids.deletedTeam"));
    return personLabel(directory?.people.find((person) => person.principalId.toLowerCase() === id.toLowerCase())?.name, id);
  }, [directory]);

  const enabledServers = useMemo(() => (servers ?? []).filter((server) => server.enabled).map((server) => server.name), [servers]);
  const profileName = useCallback((id: string) => {
    for (const answer of Object.values(perBot.perspicax)) {
      const found = answer?.available.find((profile) => profile.id === id) ?? answer?.selected.find((profile) => profile.id === id);
      if (found) return found.name;
    }
    return readableOr(id, t("bulkEdit.unknownProfile"));
  }, [perBot]);

  const formatValue = useCallback((field: string, value: unknown): string => {
    if (value === undefined || value === null || value === "") return t("bulkEdit.value.default");
    if (field === "modelSelection" && typeof value === "object") {
      const selection = value as { instanceId?: string; model?: string; effort?: string };
      const instance = state.instances.find((candidate) => candidate.instanceId === selection.instanceId);
      const engine = engineLabel(instance?.displayName, selection.instanceId ?? "");
      return [engine, selection.model, selection.effort].filter(Boolean).join(" · ");
    }
    if (field === "computer") return t(placeLabelKey((["local", "cloud", "off"].includes(String(value)) ? value : "auto") as EffectivePlace, perspicaxOrg !== null));
    if (field === "approvalMode") return APPROVAL_KEY[String(value)] ? t(APPROVAL_KEY[String(value)]!) : String(value);
    if (typeof value === "boolean") return value ? t("bulkEdit.value.on") : t("bulkEdit.value.off");
    if (Array.isArray(value)) return value.length ? value.map(String).join(", ") : t("bulkEdit.value.none");
    if (typeof value === "object") {
      const named = value as { name?: unknown; label?: unknown };
      return String(named.name ?? named.label ?? t("bulkEdit.value.custom"));
    }
    return String(value);
  }, [state.instances, perspicaxOrg]);

  /** Each field's value on each bot, as the section shows it. */
  const fieldValue = (bot: Bot, field: string): unknown => {
    if (field === "approvalMode") return botApprovalSetting(bot);
    if (field === "notifications") return bot.notifications !== false;
    if (field === "browser") return bot.browser !== false;
    return (bot as unknown as Record<string, unknown>)[field];
  };

  /** What the section shows when it is not opened: the bots' common value,
   * or "Mixed values" with each bot's value. */
  const sectionCurrent = (id: BulkSectionId): { text: string; mixed: Array<{ field: string; rows: Array<{ name: string; value: string }> }> } => {
    const mixed: Array<{ field: string; rows: Array<{ name: string; value: string }> }> = [];
    const lists: Array<{ field: string; values: Array<{ botId: string; value: string[] }> }> = [];
    if (id === "access") lists.push({ field: "mcpServers", values: bots.map((bot) => ({ botId: bot.id, value: bot.mcpServers ?? enabledServers })) });
    if (id === "sharing") lists.push({ field: "sharing", values: bots.map((bot) => ({ botId: bot.id, value: (bot.grants ?? []).map((grant) => grant.target).sort() })) });
    if (id === "perspicax") lists.push({ field: "perspicax", values: bots.map((bot) => ({ botId: bot.id, value: (perBot.perspicax[bot.id]?.selected ?? []).map((profile) => profile.id).sort() })) });
    const name = (botId: string) => bots.find((bot) => bot.id === botId)?.name ?? "";
    const listText = (field: string, items: string[]) => items.length === 0 ? t("bulkEdit.value.none")
      : items.map((item) => field === "sharing" ? grantLabel(item) : field === "perspicax" ? profileName(item) : item).join(", ");
    let main = "";
    for (const field of BULK_SECTION_FIELDS[id]) {
      const common = commonValue(bots.map((bot) => ({ botId: bot.id, value: fieldValue(bot, field) })));
      if (common.mixed) mixed.push({ field: fieldLabel(field, id), rows: common.values.map((row) => ({ name: name(row.botId), value: formatValue(field, row.value) })) });
      else if (!main) main = formatValue(field, common.value);
    }
    for (const list of lists) {
      const common = commonValue(list.values);
      const label = list.field === "mcpServers" ? fieldLabel("mcpServers", id) : sectionLabel(id);
      if (common.mixed) mixed.push({ field: label, rows: common.values.map((row) => ({ name: name(row.botId), value: listText(list.field, row.value ?? []) })) });
      else main = listText(list.field, common.value ?? []);
    }
    return { text: main, mixed };
  };

  const update = (id: BulkSectionId, next: BulkSectionChange) => setChanges((current) => ({ ...current, [id]: next }));
  const changeOf = (id: BulkSectionId): BulkSectionChange => changesRef.current[id] ?? { patch: {} };
  const reset = (id: BulkSectionId) => {
    setChanges((current) => { const next = { ...current }; delete next[id]; return next; });
    setOpened((current) => current.filter((entry) => entry !== id));
    setGeneration((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
  };

  /** Why a bot cannot take a section's change (the bot editor's own lock),
   * or null. */
  const locked = useCallback((bot: Bot, id: BulkSectionId): string | null => {
    const lock = botSectionLock(state.config, bot, id as BotSettingsSection);
    if (lock) return t(lock);
    if (id === "sharing" && !viewerCan(state.config, "sharing.grants")) return t("bulkEdit.lock.sharing");
    return null;
  }, [state.config]);

  const touched = sections.filter((id) => sectionTouched(changes[id]));

  /** "3 bots · Model → Sonnet · Voice → Ava", with each list's mode. */
  const summaryParts = (): string[] => {
    const parts: string[] = [];
    for (const id of touched) {
      const change = changes[id]!;
      for (const field of patchFields(change.patch)) {
        if (field === "mcpServers") continue;
        parts.push(t("bulkEdit.summary.field", { field: fieldLabel(field, id), value: formatValue(field, change.patch[field]) }));
      }
      const list = (label: string, mode: BulkListMode, items: string[]) =>
        parts.push(t("bulkEdit.summary.list", { field: label, mode: t(MODE_KEY[mode]).toLowerCase(), items: items.length ? items.join(", ") : t("bulkEdit.value.none") }));
      if (change.mcpServers && listActive(change.mcpServers)) list(fieldLabel("mcpServers", id), change.mcpServers.mode, change.mcpServers.items);
      if (change.grants && listActive(change.grants)) list(sectionLabel(id), change.grants.mode, change.grants.grants.map((grant) => grantLabel(grant.target)));
      if (change.perspicax && listActive(change.perspicax)) list(sectionLabel(id), change.perspicax.mode, change.perspicax.items.map(profileName));
    }
    return parts;
  };

  const deps = {
    request: api,
    saveBot: async (bot: Bot, patch: Record<string, unknown>) => {
      const saved = await persistBotUpdate(bot.id, patch as never, new AbortController().signal, api, undefined, bot as never);
      dispatch({ type: "botPatched", bot: saved as never });
      return saved;
    },
    flush: (botId: string) => flushBotPatches(botId),
    locked,
    enabledServers,
  };

  const apply = async () => {
    setStep("running");
    const run = await runBulkEdit(bots, changes, deps);
    setOutcomes(run.outcomes);
    setBefore(run.before);
    rememberBulkRun(bots.map((bot) => bot.id), run.before);
    setStep("done");
    onDone?.();
  };

  const undo = async (kept: BulkBefore[]) => {
    setUndoState("running");
    const done = await undoBulkEdit(state.bots, kept, deps);
    forgetBulkRun();
    setUndoOutcomes(done);
    setUndoState("done");
  };

  const previous = lastBulkRun();
  const titleId = "bulk-edit-title";
  const count = bots.length;
  const nameOf = (botId: string) => state.bots.find((bot) => bot.id === botId)?.name ?? t("bulkEdit.removedBot");

  const footer = step === "edit" ? (
    <>
      <button type="button" className={PILL} onClick={onClose}>{t("common.cancel")}</button>
      <button type="button" data-bulk-review className={PRIMARY_PILL} disabled={touched.length === 0 || count === 0} onClick={() => setStep("review")}>{t("bulkEdit.review")}</button>
    </>
  ) : step === "review" || step === "running" ? (
    <>
      <button type="button" className={PILL} disabled={busy} onClick={() => setStep("edit")}>{t("bulkEdit.back")}</button>
      <button type="button" data-bulk-apply className={cn(PRIMARY_PILL, "gap-1.5")} disabled={busy} onClick={() => void apply()}>
        {step === "running" && <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        {t("bulkEdit.apply")}
      </button>
    </>
  ) : (
    <>
      {before.length > 0 && undoState !== "done" && (
        <button type="button" data-bulk-undo className={cn(PILL, "mr-auto gap-1.5")} disabled={busy} onClick={() => void undo(before)}>
          {undoState === "running" ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Undo2 size={13} aria-hidden="true" />}
          {t("bulkEdit.undo")}
        </button>
      )}
      <button type="button" className={PRIMARY_PILL} disabled={busy} onClick={onClose}>{t("common.close")}</button>
    </>
  );

  return (
    <DialogLayer onBackdropMouseDown={() => { if (!busy && step !== "edit") onClose(); }}>
      <DialogFrame
        titleId={titleId}
        title={t("bulkEdit.title", { count })}
        subtitle={bots.map((bot) => bot.name).join(", ")}
        width="xl"
        closeLabel={t("common.close")}
        onClose={onClose}
        closeDisabled={busy}
        frameProps={{ "data-bulk-edit": "", "aria-busy": busy }}
        footer={footer}
      >
        {step === "edit" && (
          <>
            <p className="text-[12.5px] leading-relaxed text-ink-secondary">{t("bulkEdit.intro")}</p>
            {previous && previous.before.length > 0 && undoState === "idle" && (
              <div data-bulk-last className={cn(GROUP_CARD, "flex-row items-center justify-between gap-3 px-3.5 py-2")}>
                <span className="text-[12.5px] text-ink-secondary">{t("bulkEdit.lastRun", { count: previous.botIds.length })}</span>
                <button type="button" className={cn(PILL, "gap-1.5")} onClick={() => void undo(previous.before)}><Undo2 size={13} aria-hidden="true" />{t("bulkEdit.undo")}</button>
              </div>
            )}
            {undoState !== "idle" && <UndoResults state={undoState} outcomes={undoOutcomes} nameOf={nameOf} />}
            {sections.map((id) => {
              const isOpen = opened.includes(id);
              const change = changes[id];
              const current = sectionCurrent(id);
              const lockedBots = bots.filter((bot) => locked(bot, id) !== null);
              return (
                <section key={id} data-bulk-section={id} aria-labelledby={`bulk-${id}`} className={cn(GROUP_CARD, "px-3.5 py-2.5")}>
                  <div className="flex min-w-0 items-center gap-2">
                    <h3 id={`bulk-${id}`} className="shrink-0 text-[13px] font-semibold text-ink">{sectionLabel(id)}</h3>
                    <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-ink-secondary">
                      {sectionTouched(change) ? (
                        <span data-bulk-state="changed" className="truncate rounded-full bg-accent/15 px-2 py-0.5 font-medium text-accent-text">{t("bulkEdit.changed")}</span>
                      ) : (
                        <span data-bulk-state="unchanged" className="shrink-0">{t("bulkEdit.unchanged")}</span>
                      )}
                      {current.mixed.length > 0 ? (
                        <span data-bulk-mixed className="flex min-w-0 items-center gap-1" title={current.mixed.map((row) => `${row.field}: ${row.rows.map((entry) => `${entry.name} ${entry.value}`).join(", ")}`).join("\n")}>
                          <span className="truncate">· {t("bulkEdit.mixed")}</span>
                          <HelpTip label={t("bulkEdit.mixedDetail", { section: sectionLabel(id) })}>
                            {current.mixed.map((row) => (
                              <span key={row.field} className="mb-2 block last:mb-0">
                                <span className="block font-medium text-ink">{row.field}</span>
                                {row.rows.map((entry) => <span key={entry.name} className="block">{entry.name} : {entry.value}</span>)}
                              </span>
                            ))}
                          </HelpTip>
                        </span>
                      ) : current.text ? (
                        <span data-bulk-common className="truncate" title={current.text}>· {current.text}</span>
                      ) : null}
                    </div>
                    {isOpen || sectionTouched(change) ? (
                      <button type="button" data-bulk-reset className={cn(PILL, "shrink-0")} onClick={() => reset(id)}>{t("bulkEdit.keep")}</button>
                    ) : (
                      <button type="button" data-bulk-change className={cn(PILL, "shrink-0")} onClick={() => setOpened((list) => [...list, id])}>{t("bulkEdit.change")}</button>
                    )}
                  </div>
                  {lockedBots.length > 0 && (
                    <p data-bulk-locked className="mt-1.5 text-[12px] text-ink-secondary">
                      {t("bulkEdit.lockedBots", { names: lockedBots.map((bot) => bot.name).join(", "), reason: locked(lockedBots[0]!, id) ?? "" })}
                    </p>
                  )}
                  {isOpen && (
                    <div className="mt-3 border-t border-hairline/40 pt-3">
                      {current.mixed.length > 0 && id !== "sharing" && id !== "perspicax" && (
                        <p data-bulk-mixed-note className="mb-3 rounded-lg bg-inset px-3 py-2 text-[12px] leading-relaxed text-ink-secondary">
                          {t("bulkEdit.mixedOpen", { fields: current.mixed.map((row) => row.field).join(", ") })}
                        </p>
                      )}
                      <SectionEditor
                        key={`${id}:${generation[id] ?? 0}`}
                        id={id}
                        bots={bots}
                        viewerId={viewerId}
                        change={change}
                        fieldValue={fieldValue}
                        read={() => changeOf(id)}
                        write={(next) => update(id, next)}
                        grantLabel={grantLabel}
                        enabledServers={enabledServers}
                        perspicax={perBot.perspicax}
                        parent={parent}
                      />
                    </div>
                  )}
                </section>
              );
            })}
          </>
        )}
        {(step === "review" || step === "running") && (
          <div data-bulk-summary className="flex flex-col gap-3">
            <p className="text-[14px] leading-relaxed text-ink">
              <span className="font-semibold">{t("bulkEdit.summary.count", { count })}</span>
              {summaryParts().map((part) => <span key={part}> · {part}</span>)}
            </p>
            <p className="text-[12.5px] leading-relaxed text-ink-secondary">{t("bulkEdit.summary.how")}</p>
          </div>
        )}
        {step === "done" && outcomes && (
          <>
            <Results outcomes={outcomes} nameOf={nameOf} />
            {undoState !== "idle" && <UndoResults state={undoState} outcomes={undoOutcomes} nameOf={nameOf} />}
          </>
        )}
      </DialogFrame>
    </DialogLayer>
  );
}

function OutcomeRow({ outcome, name }: { outcome: BulkBotOutcome; name: string }) {
  return (
    <li data-bulk-result={outcome.ok ? (outcome.skipped ? "skipped" : "ok") : "failed"} className="flex min-w-0 items-start gap-2 py-2">
      {outcome.ok
        ? outcome.skipped ? <Minus size={14} className="mt-0.5 shrink-0 text-ink-secondary" aria-hidden="true" /> : <Check size={14} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
        : <CircleAlert size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />}
      <div className="min-w-0">
        <div className="text-[13px] text-ink">{name}</div>
        <div className={cn("text-[12px]", outcome.ok ? "text-ink-secondary" : "text-danger")}>
          {outcome.ok ? (outcome.skipped ? t("bulkEdit.result.skipped") : t("bulkEdit.result.ok")) : (outcome.reasons ?? []).join(" · ")}
        </div>
      </div>
    </li>
  );
}

function Results({ outcomes, nameOf }: { outcomes: BulkBotOutcome[]; nameOf: (id: string) => string }) {
  const counts = bulkOutcomeCounts(outcomes);
  return (
    <div data-bulk-results className="flex flex-col gap-2">
      <p role="status" className="text-[13px] text-ink">{t("bulkEdit.result.counts", { ok: counts.ok, failed: counts.failed, skipped: counts.skipped })}</p>
      <ul className={cn(GROUP_CARD, "divide-y divide-hairline/40 px-3.5 py-0.5")}>
        {outcomes.map((outcome) => <OutcomeRow key={outcome.botId} outcome={outcome} name={nameOf(outcome.botId)} />)}
      </ul>
    </div>
  );
}

function UndoResults({ state, outcomes, nameOf }: { state: "idle" | "running" | "done"; outcomes: BulkBotOutcome[] | null; nameOf: (id: string) => string }) {
  if (state === "running") return <p role="status" className="flex items-center gap-2 text-[12.5px] text-ink-secondary"><Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("bulkEdit.undoing")}</p>;
  if (!outcomes) return null;
  return (
    <div data-bulk-undone className="flex flex-col gap-2">
      <p role="status" className="text-[13px] text-ink">{t("bulkEdit.undone")}</p>
      <ul className={cn(GROUP_CARD, "divide-y divide-hairline/40 px-3.5 py-0.5")}>
        {outcomes.map((outcome) => <OutcomeRow key={outcome.botId} outcome={outcome} name={nameOf(outcome.botId)} />)}
      </ul>
    </div>
  );
}

/** Add, Remove or Replace with, for a list. */
function ListMode({ mode, onChange }: { mode: BulkListMode; onChange: (mode: BulkListMode) => void }) {
  return (
    <div role="radiogroup" aria-label={t("bulkEdit.mode.label")} data-bulk-list-mode={mode} className="mb-3 grid grid-cols-3 gap-0.5 rounded-lg bg-control p-0.5">
      {LIST_MODES.map((entry) => (
        <button key={entry} type="button" role="radio" aria-checked={entry === mode} data-bulk-mode={entry}
          onClick={() => { if (entry !== mode) onChange(entry); }}
          className={cn("min-h-[32px] truncate rounded-md border px-2 py-1 text-[12px]",
            entry === mode ? "border-accent-border bg-selected font-medium text-ink shadow-sm" : "border-transparent text-ink-secondary hover:bg-raised-hover hover:text-ink")}>
          {t(MODE_KEY[entry])}
        </button>
      ))}
    </div>
  );
}

const MODE_HINT: Record<BulkListMode, LocaleKey> = {
  add: "bulkEdit.mode.addHint",
  remove: "bulkEdit.mode.removeHint",
  replace: "bulkEdit.mode.replaceHint",
};

/** One opened section: the bot editor's own controls on a draft bot, in a
 * scoped store whose writes become the section's change. */
function SectionEditor({ id, bots, viewerId, change, fieldValue, read, write, grantLabel, enabledServers, perspicax, parent }: {
  id: BulkSectionId;
  bots: Bot[];
  viewerId: string | null;
  change: BulkSectionChange | undefined;
  fieldValue: (bot: Bot, field: string) => unknown;
  read: () => BulkSectionChange;
  write: (next: BulkSectionChange) => void;
  grantLabel: (target: string) => string;
  enabledServers: string[];
  perspicax: Record<string, PerspicaxAnswer | null>;
  parent: ReturnType<typeof useStore>;
}) {
  const [draftId] = useState(() => `bulk-${id}-${Math.random().toString(36).slice(2, 10)}`);
  const states = useMemo(() => sectionFieldStates(bots, id, fieldValue), [bots, id, fieldValue]);
  const baseline = useMemo(() => sectionBaseline(states), [states]);
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;
  const mixedAll = useMemo(() => mixedFieldsOf(states), [states]);
  // Once the person sets a mixed field, show their choice, not Mixed.
  const mixedActive = useMemo(() => {
    const set = new Set<string>();
    for (const field of mixedAll) {
      if (change?.patch?.[field] === undefined) set.add(field);
    }
    return set;
  }, [mixedAll, change]);
  const draftBot = bulkDraftBot(draftId, bots, viewerId, change, { section: id, fieldValue });
  const botRef = useRef(draftBot);
  botRef.current = draftBot;
  const readRef = useRef(read);
  readRef.current = read;
  const writeRef = useRef(write);
  writeRef.current = write;
  const request = useMemo(
    () => bulkSectionRequest(
      draftId,
      () => readRef.current(),
      (next) => writeRef.current(next),
      () => botRef.current,
      grantLabel,
      () => baselineRef.current,
    ),
    [draftId, grantLabel],
  );
  const applyPatch = (fields: Record<string, unknown>) => {
    const current = readRef.current();
    const { mcpServers, ...rest } = fields;
    const patch = dirtyPatch(baselineRef.current, { ...current.patch, ...rest });
    writeRef.current(Array.isArray(mcpServers)
      ? { ...current, patch, mcpServers: { mode: current.mcpServers?.mode ?? "add", items: mcpServers as string[] } }
      : { ...current, patch });
  };
  const scoped: ReturnType<typeof useStore> = {
    ...parent,
    state: { ...parent.state, bots: [draftBot, ...parent.state.bots] },
    flushBotPatches: async () => draftBot,
    dispatch: (action) => {
      if (action.type === "updateBot" && action.botId === draftId) {
        applyPatch(action.patch as Record<string, unknown>);
      } else if (action.type === "setModel" && action.botId === draftId) {
        applyPatch({ modelSelection: action.selection });
      } else if (action.type === "toggleSettings" || action.type === "botPatched") {
        // editor links and saved answers stay inside this dialog
      } else parent.dispatch(action);
    },
  };

  const listMode = (kind: "mcpServers" | "grants" | "perspicax"): ReactNode => {
    const current = kind === "grants" ? change?.grants?.mode : change?.[kind]?.mode;
    const mode = current ?? "add";
    const lists = kind === "mcpServers" ? bots.map((bot) => bot.mcpServers ?? enabledServers)
      : kind === "grants" ? bots.map((bot) => (bot.grants ?? []).map((grant) => grant.target))
        : bots.map((bot) => (perspicax[bot.id]?.selected ?? []).map((profile) => profile.id));
    return (
      <>
        <ListMode mode={mode} onChange={(next) => {
          const base = read();
          const start = listStart(next, lists);
          if (kind === "grants") {
            const levels = new Map(bots.flatMap((bot) => bot.grants ?? []).map((grant) => [grant.target, grant.level]));
            write({ ...base, grants: { mode: next, grants: start.map((target) => ({ target, level: levels.get(target) ?? "use" })) } });
          } else write({ ...base, [kind]: { mode: next, items: start } });
        }} />
        <p className="-mt-1 mb-3 text-[12px] text-ink-secondary">{t(MODE_HINT[mode])}</p>
      </>
    );
  };

  return (
    <BotEditorStore value={scoped}>
      <BotEditorContext.Provider value={{ request, draft: true, bulk: true, mixedFields: mixedActive }}>
        {id === "sharing" && listMode("grants")}
        {id === "access" && (
          <div data-bulk-list="mcpServers">
            <div className="mb-1.5 text-[12px] font-medium text-ink-secondary">{t("connectors.tab.mcp")}</div>
            {listMode("mcpServers")}
          </div>
        )}
        {id === "perspicax" ? (
          <>
            {listMode("perspicax")}
            <BulkPerspicax bots={bots} answers={perspicax} change={change} read={read} write={write} />
          </>
        ) : <SectionBody id={id} bot={draftBot} />}
      </BotEditorContext.Provider>
    </BotEditorStore>
  );
}

/** The section component of the bot editor, as Edit bot draws it. */
function SectionBody({ id, bot }: { id: BulkSectionId; bot: Bot }) {
  const derived = useBotSettingsDerived(bot);
  switch (id) {
    case "model": return <ModelSection bot={bot} />;
    case "sharing": return <SharingSection bot={bot} />;
    case "worksOn": return <WorksOnSetting bot={bot} />;
    case "access": return <AccessSection bot={bot} derived={derived} />;
    case "voice": return <VoiceSection bot={bot} derived={derived} />;
    case "permissions": return <PermissionsSection bot={bot} derived={derived} />;
    default: return null;
  }
}

/** Perspicax Profiles: the editor's own profile rows, every profile the
 * viewer holds or a selected bot has; the checks are the list edit's items. */
function BulkPerspicax({ bots, answers, change, read, write }: {
  bots: Bot[];
  answers: Record<string, PerspicaxAnswer | null>;
  change: BulkSectionChange | undefined;
  read: () => BulkSectionChange;
  write: (next: BulkSectionChange) => void;
}) {
  const loaded = bots.every((bot) => bot.id in answers);
  if (!loaded) {
    return <div className="flex items-center gap-2 text-[13px] text-ink-secondary"><Loader2 size={13} className="animate-spin" aria-hidden="true" />{t("botSettings.perspicax.loading")}</div>;
  }
  const available = new Map<string, PerspicaxProfile>();
  for (const answer of Object.values(answers)) {
    for (const profile of answer?.available ?? []) available.set(profile.id, profile);
    for (const { heldByMe: _held, ...profile } of answer?.selected ?? []) if (!available.has(profile.id)) available.set(profile.id, profile);
  }
  const edit = change?.perspicax ?? { mode: "add" as BulkListMode, items: [] };
  const rows = perspicaxRows({ available: [...available.values()], selected: [], canEdit: true }, edit.items);
  if (rows.length === 0) return <p className="text-[13px] text-ink-secondary">{t("botSettings.perspicax.none")}</p>;
  const lists = bots.map((bot) => (answers[bot.id]?.selected ?? []).map((profile) => profile.id));
  const everyone = new Set(commonListItems(lists));
  return (
    <ul className={cn(GROUP_CARD, "divide-y divide-hairline/40 px-3.5 py-0.5")} aria-label={t("botSettings.perspicax.title")}>
      {rows.map((row) => (
        <PerspicaxProfileControl
          key={row.profile.id}
          row={{ ...row, profile: { ...row.profile, description: [row.profile.description, everyone.has(row.profile.id) ? t("bulkEdit.allHave") : ""].filter(Boolean).join(" · ") } }}
          saving={false}
          canRemove={false}
          onToggle={(on) => {
            const base = read();
            const current = base.perspicax ?? edit;
            const items = on ? [...current.items.filter((item) => item !== row.profile.id), row.profile.id] : current.items.filter((item) => item !== row.profile.id);
            write({ ...base, perspicax: { mode: current.mode, items } });
          }}
          onRemove={() => {}}
        />
      ))}
    </ul>
  );
}
