// An AcmeGuard threat in the record window (M-20261127-141): its verdict and
// what the agent already did (quarantine, process killed); Undo the changes,
// Isolate from the network, True threat, False positive and "Create a ticket"
// (a bot, in the chat); the execution chain as a tree; the file's facts; the
// endpoint. Tabs: Overview, Timeline, Endpoint, Notes, and Exclusions only
// when the threat has some (M-20261127-143).
//
// The console's sections: `view` (verdict, done, tree, file, device,
// device_tiles, device_facts), `timeline`, `notes`, `exclusions`. A console
// that serves no `view` leaves the overview to the card's facts, and the
// timeline to the card's list (the threat card's timeline today).
import { Check, Laptop, ShieldAlert, Undo2 } from "lucide-react";
import { RecordPod } from "@/components/record-window/RecordBlocks";
import { RecordList, type RecordColumn } from "@/components/record-window/RecordGrid";
import { RecordName } from "@/components/record-window/ticket/parts";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { parseExclusion, parseLines, parseSteps, parseThreatView, type ThreatExclusion, type ViewStep } from "@/lib/record-plugin-views";
import type { RecordCard as Card } from "../../../../shared/record-cards";
import { AskButton, FactList, PluginNotes, SectionStatus, StatePill, Steps, TONE_TEXT, ToneDot, Tiles, WriteButton, tabCount, type PluginContext } from "./PluginParts";
import type { PluginWindowSpec } from "./PluginWindow";

/** The card's own list as a timeline (a console that serves no `timeline` section). */
function cardSteps(card: Card): ViewStep[] {
  return (card.lines?.items ?? []).map((line) => ({ text: line.label, ...(line.detail ? { when: line.detail } : {}) }));
}

function Overview({ ctx }: { ctx: PluginContext }) {
  const { detail } = ctx;
  const state = detail.section("view");
  const view = parseThreatView(state.data);
  if (!view) return <SectionStatus state={state} />;
  const verdict = view.verdict;
  const isolate = view.device?.isolated
    ? <WriteButton detail={detail} action={{ action: "threat.reconnect" }} label={t("recordWindow.threat.reconnect")} />
    : <WriteButton detail={detail} action={{ action: "threat.isolate" }} label={t("recordWindow.threat.isolate")} />;
  return (
    <>
      <RecordPod data-record-threat-verdict="">
        <div className="flex min-w-0 flex-wrap items-center gap-4">
          <span aria-hidden="true" className={cn("inline-flex size-12 shrink-0 items-center justify-center rounded-xl", verdict?.tone === "alert" ? "bg-danger/15 text-danger" : "bg-popover-hover text-popover-ink-secondary")}><ShieldAlert size={22} /></span>
          <div className="flex min-w-0 flex-1 flex-col">
            {verdict && <span className={cn("text-[20px] font-semibold leading-7", TONE_TEXT[verdict.tone] === "text-popover-ink-secondary" ? "" : TONE_TEXT[verdict.tone])}>{verdict.label}</span>}
            {verdict?.detail && <span dir="auto" className="text-[13px] leading-[18px] text-popover-ink-secondary">{verdict.detail}</span>}
          </div>
          {view.done.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5" data-record-threat-done="">
              {view.done.map((done) => <span key={done} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-popover-hover px-2.5 text-[13px] leading-[18px]"><Check size={13} aria-hidden="true" className="text-success" />{done}</span>)}
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          <WriteButton detail={detail} action={{ action: "threat.rollback" }} label={t("recordWindow.threat.rollback")} primary icon={<Undo2 size={14} aria-hidden="true" />} />
          {isolate}
          <WriteButton detail={detail} action={{ action: "threat.verdict", set: { verdict: "true_positive" } }} label={t("recordWindow.threat.truePositive")} />
          <WriteButton detail={detail} action={{ action: "threat.verdict", set: { verdict: "false_positive" } }} label={t("recordWindow.threat.falsePositive")} />
          <span className="ms-auto"><AskButton ask={ctx.ask} label={t("recordWindow.threat.ticket")} prompt={t("recordWindow.threat.ticketPrompt", { record: ctx.link })} /></span>
        </div>
      </RecordPod>
      {(view.tree.length > 0 || view.file.length > 0) && (
        <div className="grid min-w-0 grid-cols-1 gap-4 @min-[52rem]:grid-cols-2">
          {view.tree.length > 0 && (
            <RecordPod title={t("recordWindow.threat.chain")} data-record-threat-tree="">
              <ul className="flex min-w-0 flex-col gap-3">
                {view.tree.map((node, index) => (
                  <li key={`${index}-${node.name}`} className="flex min-w-0 items-start gap-2.5" style={{ paddingInlineStart: node.depth * 18 }}>
                    <ToneDot tone={node.tone ?? "done"} className="mt-[7px] size-2.5" />
                    <span className="flex min-w-0 flex-col">
                      <code className="w-fit max-w-full rounded-md bg-popover-hover px-1.5 py-0.5 font-mono text-[13px] leading-5 [overflow-wrap:anywhere]">{node.name}</code>
                      {node.detail && <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{node.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </RecordPod>
          )}
          {view.file.length > 0 && <RecordPod title={t("recordWindow.attachments.file")} data-record-threat-file=""><FactList facts={view.file} /></RecordPod>}
        </div>
      )}
      {view.device && (
        <RecordPod data-record-threat-device="">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-popover-hover text-popover-ink-secondary"><Laptop size={16} /></span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium"><RecordName name={view.device.name} recordRef={view.device.ref} /></span>
              {view.device.detail && <span dir="auto" className="text-[13px] leading-[18px] text-popover-ink-secondary">{view.device.detail}</span>}
            </span>
            {view.device.state && <StatePill label={view.device.state.label} tone={view.device.state.tone} />}
            {isolate}
          </div>
        </RecordPod>
      )}
    </>
  );
}

function Timeline({ ctx }: { ctx: PluginContext }) {
  const state = ctx.detail.section("timeline");
  const steps = state.data ? parseLines(state.data, (line) => parseSteps([line])[0] ?? null) : state.refused ? cardSteps(ctx.card) : null;
  if (!steps) return <SectionStatus state={state} />;
  return <RecordPod><Steps steps={steps} now={ctx.now} /></RecordPod>;
}

function Device({ ctx }: { ctx: PluginContext }) {
  const state = ctx.detail.section("view");
  const view = parseThreatView(state.data);
  if (!view) return <SectionStatus state={state} />;
  return (
    <>
      <Tiles tiles={view.deviceTiles} />
      {view.deviceFacts.length > 0 && <RecordPod><FactList facts={view.deviceFacts} /></RecordPod>}
    </>
  );
}

function Exclusions({ ctx }: { ctx: PluginContext }) {
  const state = ctx.detail.section("exclusions");
  if (!state.data) return <SectionStatus state={state} />;
  const rows = parseLines(state.data, parseExclusion);
  const columns: RecordColumn<ThreatExclusion>[] = [
    { id: "value", label: t("recordWindow.threat.exclusion"), text: (row) => row.value },
    { id: "type", label: t("recordCard.related.type"), text: (row) => row.type ?? "" },
    { id: "scope", label: t("recordWindow.threat.scope"), text: (row) => row.scope ?? "" },
  ];
  return (
    <RecordPod>
      <RecordList label={t("recordWindow.threat.exclusions")} columns={columns} rows={rows} rowKey={(row) => row.id ?? row.value}
        row={(row) => (
          <span className="flex min-w-0 flex-1 flex-col">
            <code className="w-fit max-w-full rounded-md bg-popover-hover px-1.5 py-0.5 font-mono text-[13px] leading-5 [overflow-wrap:anywhere]">{row.value}</code>
            <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{[row.type, row.scope].filter(Boolean).join(" · ")}</span>
          </span>
        )} />
    </RecordPod>
  );
}

export const THREAT_WINDOW: PluginWindowSpec = {
  first: "overview",
  open: ["view", "timeline", "notes"],
  core: "view",
  reads: { overview: ["view"], timeline: ["timeline"], device: ["view"], notes: ["notes"], exclusions: ["exclusions"] },
  tabs: (ctx) => {
    const { detail } = ctx;
    const view = detail.section("view");
    const parsed = parseThreatView(view.data);
    const timeline = detail.section("timeline");
    return [
      { id: "overview", label: t("recordWindow.plugin.overview") },
      { id: "timeline", label: t("recordWindow.threat.timeline"), count: timeline.refused ? ctx.card.lines?.total ?? ctx.card.lines?.items.length ?? 0 : tabCount(detail, "timeline", timeline.data ? parseLines(timeline.data, (line) => line).length : undefined) },
      // shown while it reads and when it holds something, never with a number of its own
      { id: "device", label: t("recordWindow.threat.device"), count: view.refused || (parsed && !parsed.deviceTiles.length && !parsed.deviceFacts.length) ? 0 : undefined },
      { id: "notes", label: t("recordWindow.tabs.notes"), count: tabCount(detail, "notes"), canAdd: detail.can("note.add") },
      { id: "exclusions", label: t("recordWindow.threat.exclusions"), count: tabCount(detail, "exclusions") ?? 0 },
    ];
  },
  body: (ctx, tab) => (
    <div className="flex min-w-0 flex-col gap-4 p-4" data-record-threat-tab={tab}>
      {tab === "overview" && <Overview ctx={ctx} />}
      {tab === "timeline" && <Timeline ctx={ctx} />}
      {tab === "device" && <Device ctx={ctx} />}
      {tab === "notes" && <PluginNotes detail={ctx.detail} now={ctx.now} />}
      {tab === "exclusions" && <Exclusions ctx={ctx} />}
    </div>
  ),
};
