// Pieces shared by the in-chat approval card and the composer's pending
// approval panel, so both read the same way: an icon, a human title, the
// read or write mark, and the raw tool id + JSON only behind "Details".
import { copyText } from "@/lib/copy-text";
import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, Eye, PencilLine, Play, ShieldCheck, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { RISK_LABEL, type ApprovalRisk } from "@/lib/approval-describe";

// #3414: the read or write mark is a quiet word with its icon, in the
// risk's ink, never a filled pill (the reference: color only for a real state)
const RISK_STYLE: Record<ApprovalRisk, string> = {
  read: "text-success",
  write: "text-warning",
  execute: "text-warning",
  destructive: "text-danger",
};

const RISK_ICON = { read: Eye, write: PencilLine, execute: Play, destructive: Trash2 } as const;

export function RiskChip({ risk }: { risk: ApprovalRisk }) {
  const Icon = RISK_ICON[risk];
  return (
    <span
      data-risk={risk}
      className={cn("inline-flex shrink-0 items-center gap-1 text-[12px] font-medium", RISK_STYLE[risk])}
    >
      <Icon size={12} aria-hidden="true" />
      {t(RISK_LABEL[risk])}
    </span>
  );
}

/** The compact card's head (#3414), the shape of every ask of the chat
 * (AskCard): an icon, the ask in one line, then one line under it with the
 * read or write mark and what it does. The bot is named in the title only,
 * never again by an avatar. */
export function ApprovalHeading({
  title,
  summary,
  risk,
  context,
  aside,
}: {
  title: ReactNode;
  summary?: string;
  risk?: ApprovalRisk;
  /** a quiet line on where it comes from (another bot, a parallel task) */
  context?: ReactNode;
  /** right side of the title row (the stepper, the pinned card's controls) */
  aside?: ReactNode;
}) {
  const line = summary?.trim();
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span aria-hidden="true" className="flex h-5 shrink-0 items-center text-accent-text">
        <ShieldCheck size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <span dir="auto" className="block break-words text-[14px] font-semibold leading-5 text-ink" data-approval-title="">{title}</span>
        {(risk || line) && (
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] leading-5 text-ink-secondary" data-approval-summary="">
            {risk && <RiskChip risk={risk} />}
            {risk && line && <span aria-hidden="true">·</span>}
            {line && <span className="min-w-0">{line}</span>}
          </div>
        )}
        {context}
      </div>
      {aside && <div className="-my-0.5 flex shrink-0 items-center gap-0.5">{aside}</div>}
    </div>
  );
}

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** Pretty JSON with keys, strings, numbers and literals colored. Plain
 * text (a command) passes through uncolored. */
export function JsonText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(JSON_TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const [whole, str, colon, literal, number] = match;
    if (str !== undefined) {
      out.push(<span key={index++} className={colon ? "text-accent" : "text-success"}>{str}</span>);
      if (colon) out.push(colon);
    } else if (literal !== undefined) {
      out.push(<span key={index++} className="text-danger">{literal}</span>);
    } else if (number !== undefined) {
      out.push(<span key={index++} className="text-warning">{number}</span>);
    } else {
      out.push(whole);
    }
    last = at + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        void copyText(text).then((result) => { if (result === "copied") setCopied(true); });
      }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-ink-secondary hover:bg-control hover:text-ink"
    >
      {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
      {copied ? t("approval.details.copied") : t("approval.details.copy")}
    </button>
  );
}

/** "See technical details": collapsed by default, it holds the tool id,
 * its server and the arguments as colored, scrollable JSON. */
export function TechnicalDetails({
  tool,
  server,
  args,
  defaultOpen = false,
  argsLabel,
}: {
  tool?: string;
  server?: string;
  args?: string;
  defaultOpen?: boolean;
  /** aria-label of the arguments block */
  argsLabel?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!tool && !args) return null;
  return (
    <div className="mt-2" data-technical-details={open ? "open" : "closed"}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1 rounded-md py-0.5 text-[12.5px] text-ink-secondary hover:text-ink"
      >
        <ChevronDown size={13} aria-hidden="true" className={cn("transition-transform", open ? "rotate-0" : "-rotate-90")} />
        {open ? t("approval.details.hideFull") : t("approval.details.viewFull")}
      </button>
      {open && (
        <div className="mt-1.5 rounded-xl border border-hairline/40 bg-inset px-3 py-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
            {tool && (
              <>
                <dt className="text-ink-secondary">{t("approval.details.tool")}</dt>
                <dd className="min-w-0 break-all font-mono text-ink">{tool}</dd>
              </>
            )}
            {server && (
              <>
                <dt className="text-ink-secondary">{t("approval.details.server")}</dt>
                <dd className="min-w-0 break-all font-mono text-ink">{server}</dd>
              </>
            )}
          </dl>
          {args && (
            <>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[12px] text-ink-secondary">{t("approval.details.arguments")}</span>
                <CopyButton text={args} />
              </div>
              <pre
                tabIndex={0}
                aria-label={argsLabel ?? t("approval.aria.details")}
                className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink"
              >
                <JsonText text={args} />
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
