// Import a shared Grok Bot (port of OpenMausBot #3073, without its Cursor
// sign-in). Three ways in: paste the x.ai link (the server reads the public
// card: POST /api/team-library/grok), paste the reply the person's own Grok
// Bot writes to GROK_EXPORT_PROMPT, or drop that reply saved as a .json file
// (also pi-grokbot-import's grokbot-bundle/v1). Every way ends in the usual
// team import preview (skills off, routines paused, no model, no keys), with
// what could not come over listed under Left out.
import { useRef, useState } from "react";
import { Copy, FileUp } from "lucide-react";
import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { copyText } from "@/lib/copy-text";
import { teamImportPreview, type PendingTeamImport } from "@/lib/team-import";
import {
  GROK_EXPORT_PROMPT, GrokImportError, grokExportToPackage, grokStarterPackage, isGrokLink, parseGrokExport,
  type GrokLeftOut, type GrokTemplateCard,
} from "../../shared/grok-import";

const MAX_FILE_BYTES = 4 * 1024 * 1024;

function timeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

/** A pasted reply or a file's text as a preview, plus what was left out. */
export function grokPreviewFrom(text: string, card?: GrokTemplateCard | null): { pending: PendingTeamImport; leftOut: GrokLeftOut[] } {
  const exported = parseGrokExport(text);
  const { document, leftOut } = grokExportToPackage(exported, { sourceUrl: card?.url, timeZone: timeZone() });
  return { pending: teamImportPreview(document), leftOut };
}

export function GrokImportBox({ onPreview }: { onPreview: (pending: PendingTeamImport, leftOut: GrokLeftOut[]) => void }) {
  const [link, setLink] = useState("");
  const [card, setCard] = useState<GrokTemplateCard | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const fail = (cause: unknown) => setError(cause instanceof GrokImportError || cause instanceof Error ? cause.message : String(cause));

  const loadCard = async () => {
    if (!link.trim() || busy) return;
    if (!isGrokLink(link)) { setError(t("grokImport.badLink")); return; }
    setBusy(true);
    setError("");
    try {
      setCard(await api<GrokTemplateCard>("/api/team-library/grok", { method: "POST", body: JSON.stringify({ url: link.trim() }) }));
    } catch (cause) { fail(cause); }
    finally { setBusy(false); }
  };

  const fromText = (text: string) => {
    setError("");
    try {
      const { pending, leftOut } = grokPreviewFrom(text, card);
      onPreview(pending, leftOut);
    } catch (cause) { fail(cause); }
  };

  const copyPrompt = async () => {
    if (await copyText(GROK_EXPORT_PROMPT) !== "copied") { setError(t("grokImport.copyFailed")); return; }
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  };

  const inputClass = "min-w-0 flex-1 rounded-md border border-hairline/40 bg-inset px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent disabled:opacity-50";
  const buttonClass = "inline-flex shrink-0 items-center gap-1.5 rounded-md bg-control px-2.5 py-1.5 text-[12px] text-ink hover:bg-raised-hover disabled:opacity-50";

  return (
    <div className="flex flex-col gap-3" data-grok-import="">
      <p className="text-[12.5px] leading-relaxed text-ink-secondary">{t("grokImport.intro")}</p>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void loadCard(); }}>
        <label htmlFor="grok-import-link" className="sr-only">{t("grokImport.linkLabel")}</label>
        <input id="grok-import-link" value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://x.ai/bot/..." maxLength={500} disabled={busy} className={inputClass} />
        <button type="submit" className={buttonClass} disabled={busy || !link.trim()}>{busy ? t("grokImport.loading") : t("grokImport.load")}</button>
      </form>
      {card && (
        <div className="rounded-lg bg-raised/30 px-3 py-2" data-grok-card="">
          <div className="text-[13px] font-medium text-ink">{card.name}</div>
          {card.creator && <div className="text-[12px] text-ink-secondary">{t("grokImport.by", { creator: card.creator })}</div>}
          {card.description && <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{card.description}</p>}
          <button type="button" className={`${buttonClass} mt-2`} onClick={() => { try { onPreview(teamImportPreview(grokStarterPackage(card)), []); } catch (cause) { fail(cause); } }}>
            {t("grokImport.fromDescription")}
          </button>
        </div>
      )}
      <ol className="list-decimal space-y-1 pl-5 text-[12.5px] leading-relaxed text-ink-secondary">
        <li>{t("grokImport.step1")} <button type="button" className={`${buttonClass} ml-1`} onClick={() => void copyPrompt()} data-grok-copy-prompt=""><Copy size={12} />{copied ? t("grokImport.copied") : t("grokImport.copyPrompt")}</button></li>
        <li>{t("grokImport.step2")}</li>
      </ol>
      <label htmlFor="grok-import-reply" className="sr-only">{t("grokImport.replyLabel")}</label>
      <textarea id="grok-import-reply" value={reply} onChange={(event) => setReply(event.target.value)} rows={5} placeholder={t("grokImport.replyPlaceholder")} className={`${inputClass} font-mono text-[12px]`} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={!reply.trim()} onClick={() => fromText(reply)} data-grok-preview="">{t("grokImport.preview")}</button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            if (file.size > MAX_FILE_BYTES) { setError(t("grokImport.tooLarge")); return; }
            void file.text().then(fromText, fail);
          }}
        />
        <button type="button" className={buttonClass} onClick={() => fileRef.current?.click()}><FileUp size={12} />{t("grokImport.file")}</button>
      </div>
      {error ? <p role="alert" className="text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}

/** What the import could not carry, with the original text to redo it by hand. */
export function GrokLeftOutList({ leftOut }: { leftOut: GrokLeftOut[] }) {
  if (!leftOut.length) return null;
  return (
    <div className="mt-4 rounded-lg bg-raised/25 px-3 py-2" data-grok-left-out="">
      <div className="text-[12px] font-medium text-ink">{t("grokImport.leftOut")}</div>
      <ul className="mt-1 space-y-1.5">
        {leftOut.map((item, index) => (
          <li key={`${item.kind}-${index}`} className="text-[12px] text-ink-secondary">
            <span className="text-ink">{item.name}</span>: {item.reason}
            {item.original ? <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-inset px-2 py-1 text-[11px]">{item.original}</pre> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
