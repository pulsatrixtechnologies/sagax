// A card of preference lines for the person's primary bot. The list is the
// server's preview. Nothing is written until they apply, and a line that
// would replace one starts unchecked.
import { useState } from "react";

import { t } from "@/lib/i18n";
import { api, useStore } from "@/state/store";
import { SettingsGroup } from "../SettingsPrimitives";

interface PreviewLine {
  id: string;
  text: string;
  kind: "add" | "same" | "conflict";
  existing?: string;
}

export function PreferenceImportCard({ bare = false }: { bare?: boolean } = {}) {
  const { state } = useStore();
  const primaries = state.bots.filter((bot) => bot.chiefOfStaff);
  const [botId, setBotId] = useState(primaries[0]?.id ?? "");
  const [text, setText] = useState("");
  const [lines, setLines] = useState<PreviewLine[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = primaries.some((bot) => bot.id === botId) ? botId : (primaries[0]?.id ?? "");

  const preview = () => {
    if (!chosen || !text.trim()) return;
    setBusy(true);
    setMessage("");
    void api<{ lines: PreviewLine[] }>("/api/me/preference-import/preview", {
      method: "POST",
      body: JSON.stringify({ botId: chosen, text }),
    }).then((body) => {
      const next: Record<string, boolean> = {};
      for (const line of body.lines) next[line.id] = line.kind === "add";
      setLines(body.lines);
      setChecked(next);
    }).catch(() => setMessage(t("prefImport.error"))).finally(() => setBusy(false));
  };

  const apply = () => {
    if (!chosen || !lines) return;
    const accept = lines.filter((line) => line.kind !== "same" && checked[line.id]).map((line) => line.id);
    setBusy(true);
    void api("/api/me/preference-import/apply", {
      method: "POST",
      body: JSON.stringify({ botId: chosen, text, accept }),
    }).then(() => {
      setMessage(t("prefImport.done"));
      setLines(null);
      setText("");
    }).catch(() => setMessage(t("prefImport.error"))).finally(() => setBusy(false));
  };

  const body = (
      <div className={`flex flex-col gap-2 ${bare ? "px-0 py-0" : "px-3.5 py-3"}`} data-preference-import="">
        {!bare && <p className="text-[12.5px] text-ink-secondary">{t("prefImport.intro")}</p>}
        {primaries.length === 0 ? <p className="text-[12.5px] text-ink">{t("prefImport.noPrimary")}</p> : null}
        {primaries.length > 1 ? (
          <select aria-label={t("prefImport.bot")} value={chosen} onChange={(event) => { setBotId(event.target.value); setLines(null); }}
            className="max-w-64 rounded border border-hairline/60 bg-raised px-2 py-1 text-[12.5px] text-ink">
            {primaries.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
          </select>
        ) : null}
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={6} aria-label={t("prefImport.lines")}
          className="w-full rounded border border-hairline/60 bg-raised px-2 py-1.5 text-[12.5px] text-ink" />
        <button type="button" disabled={busy || !chosen || !text.trim()} onClick={preview}
          className="self-start rounded px-2 py-1 text-[12.5px] text-ink hover:bg-hover disabled:opacity-40">{t("prefImport.preview")}</button>
        {lines && lines.length === 0 ? <p className="text-[12.5px] text-ink-secondary">{t("prefImport.none")}</p> : null}
        {lines && lines.length > 0 ? (
          <ul className="flex flex-col gap-1.5" data-preference-card="">
            {lines.map((line) => (
              <li key={line.id} data-preference-kind={line.kind} className="text-[12.5px] text-ink">
                {line.kind === "same" ? (
                  <span>{t("prefImport.same")}: {line.text}</span>
                ) : (
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={checked[line.id] === true} onChange={(event) => setChecked((current) => ({ ...current, [line.id]: event.target.checked }))} />
                    <span>
                      {line.kind === "add" ? t("prefImport.add") : t("prefImport.replace")}
                      {": "}{line.text}
                      {line.kind === "conflict" && line.existing ? <span className="block text-ink-secondary">{t("prefImport.current")}: {line.existing}</span> : null}
                    </span>
                  </label>
                )}
              </li>
            ))}
            <li>
              <button type="button" disabled={busy} onClick={apply} className="rounded px-2 py-1 text-[12.5px] text-ink hover:bg-hover disabled:opacity-40">{t("prefImport.apply")}</button>
            </li>
          </ul>
        ) : null}
        {message ? <p role="status" className="text-[12.5px] text-ink">{message}</p> : null}
      </div>
  );

  if (bare) return body;
  return (
    <SettingsGroup title={t("prefImport.title")} groupId="preference-import">
      {body}
    </SettingsGroup>
  );
}
