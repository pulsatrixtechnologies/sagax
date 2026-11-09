import { t } from "@/lib/i18n";
import type { Message } from "@/state/store";
import { stepDuration, stepLabel } from "@/lib/step-label";
import { StepRow } from "./StepRow";

/** The work digest as one quiet step row under a reply: how many tools the
 * turn used and how many files it changed, opening to the digest itself.
 * Shown under the same setting as tool steps (Settings → Tool calls),
 * because it is the summary of exactly those. */
export function DigestChip({ message }: { message: Message }) {
  const digest = message.digest;
  if (!digest) return null;
  const files = digest.files ? digest.files.changed.length + digest.files.added.length + digest.files.deleted.length + (digest.files.truncated ?? 0) : null;
  // Like the phone transcript, omit receipts for ordinary replies with no
  // observed work. Who paid for the turn is never shown here.
  // Missing file capture does not itself imply any changes.
  if (!digest.tools.length && !digest.toolCalls && !digest.toolsDropped &&
      !files && !digest.memory.length && !digest.memoryDropped) return null;
  const tools = digest.toolCalls ?? `${digest.tools.reduce((n, tool) => n + tool.count, 0)}${digest.toolsDropped ? "+" : ""}`;
  const used = t(String(tools) === "1" ? "step.digest.one" : "step.digest.many", { tools });
  const changed = files ? t(files === 1 ? "step.digest.files.one" : "step.digest.files.many", { files }) : undefined;
  return (
    <div className="flex justify-start" data-testid="digest-chip">
      <StepRow
        label={used}
        target={changed}
        duration={stepDuration(digest.durationMs)}
        title={t("chat.digestTitle")}
      >
        {() => <DigestDetail message={message} />}
      </StepRow>
    </div>
  );
}

/** The digest opened: the tools and files it counted. message.text is the
 * server's "[digest] · tools … · reply …" line, kept for the model and
 * search only: never shown to the person. */
export function DigestDetail({ message }: { message: Message }) {
  const digest = message.digest!;
  const files = digest.files ? [...digest.files.added, ...digest.files.changed, ...digest.files.deleted] : [];
  return (
    <div className="space-y-2 py-1 text-[12px] text-ink-secondary" data-testid="digest-detail">
      {digest.tools.length > 0 && (
        <ul className="space-y-0.5">
          {digest.tools.map((tool) => (
            <li key={tool.name} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-ink">{stepLabel({ name: tool.name, ok: true })}</span>
              <span className="tabular-nums text-ink-tertiary">×{tool.count}</span>
              <code dir="ltr" className="font-mono text-[11px] text-ink-tertiary">{tool.name}</code>
              {tool.failed ? <span className="text-danger/90">{t("toolDetail.failed")} ×{tool.failed}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="space-y-0.5 font-mono text-[11.5px]" dir="ltr">
          {files.slice(0, 12).map((file) => <li key={file} className="truncate">{file}</li>)}
        </ul>
      )}
    </div>
  );
}

/** A fold the person asked for is visible even when ordinary tool chips are
 * hidden. Sagax's own folds never show (server/context/context-budget.ts). */
export function CompactionChip({ message }: { message: Message }) {
  if (!message.compaction || message.compaction.by === "harness") return null;
  return (
    <details className="max-w-[600px] rounded-xl border border-hairline/40 bg-panel px-3 py-2 text-[12px] text-ink-secondary" data-testid="compaction-chip">
      <summary className="cursor-pointer font-medium">{t("chat.compactionTitle")}</summary>
      <p className="mt-2">{t("chat.compactionHint")}</p>
      <p className="mt-2 whitespace-pre-wrap break-words">{message.compaction.summary}</p>
    </details>
  );
}
