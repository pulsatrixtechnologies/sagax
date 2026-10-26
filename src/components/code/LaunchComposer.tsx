// The launch composer at the top of the Code list: the environment picker
// (the repository a run starts from), the task, the engine and model, and
// suggestion chips. Settings (environments, Git, automations) live in the
// Perspicax console; this only starts a run.
import { ArrowUp, ChevronDown, Cloud, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { RUN_ENGINES } from "../../../shared/cloud-agents.ts";
import type { CodeEnvironment } from "@/lib/code-runs";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export interface LaunchComposerProps {
  environments: CodeEnvironment[];
  consoleUrl?: string;
  busy?: boolean;
  error?: string | null;
  onLaunch: (input: { env_id: string; prompt: string; engine: string; model?: string }) => void;
}

const ENGINE_LABEL: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex" };

export function LaunchComposer({ environments, consoleUrl, busy = false, error, onLaunch }: LaunchComposerProps) {
  const [envId, setEnvId] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [engine, setEngine] = useState<string>("");
  const [model, setModel] = useState("");
  const [picker, setPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const env = environments.find((row) => row.id === envId) ?? environments[0];
  useEffect(() => {
    if (!env) return;
    setEngine((current) => current || env.engine_default);
    setModel(env.model_default);
  }, [env]);
  useEffect(() => {
    if (!picker) return;
    const close = (event: MouseEvent) => { if (!pickerRef.current?.contains(event.target as Node)) setPicker(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [picker]);

  const submit = () => {
    const text = prompt.trim();
    if (!env || !text || busy) return;
    onLaunch({ env_id: env.id, prompt: text, engine: engine || env.engine_default, ...(model.trim() ? { model: model.trim() } : {}) });
    setPrompt("");
  };

  if (environments.length === 0) {
    return (
      <div data-code-no-env className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-hairline bg-card px-4 py-4">
        <span className="flex items-center gap-2 text-[14px] font-medium text-ink"><Cloud size={15} aria-hidden />{t("code.launch.setupTitle")}</span>
        <span className="text-[13px] text-ink-secondary">{t("code.launch.setupBody")}</span>
        {consoleUrl && <a href={consoleUrl} target="_blank" rel="noreferrer" className="ui-button ui-button-sm">{t("code.launch.setupCta")}</a>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div ref={pickerRef} className="relative flex items-center gap-2">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={picker}
          aria-label={t("code.launch.envAria")}
          onClick={() => setPicker((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] text-ink-secondary hover:bg-hover hover:text-ink"
        >
          {env?.name ?? t("code.launch.env")}
          <ChevronDown size={13} aria-hidden />
        </button>
        <Cloud size={13} aria-hidden className="text-ink-tertiary" />
        {picker && (
          <ul role="listbox" aria-label={t("code.launch.envAria")} className="absolute left-0 top-8 z-20 w-72 rounded-lg border border-popover-border bg-popover p-1 shadow-lg">
            {environments.map((row) => (
              <li key={row.id} role="option" aria-selected={row.id === env?.id}>
                <button
                  type="button"
                  onClick={() => { setEnvId(row.id); setEngine(row.engine_default); setPicker(false); }}
                  className={cn("flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-popover-hover", row.id === env?.id && "bg-popover-hover")}
                >
                  <span className="text-[13px] text-popover-ink">{row.name}</span>
                  <span className="text-[11.5px] text-popover-ink-secondary">{t(`code.scope.${row.scope}` as "code.scope.personnelle")} · {ENGINE_LABEL[row.engine_default] ?? row.engine_default}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-2xl border border-hairline bg-composer px-3 pb-2 pt-3 focus-within:ring-2 focus-within:ring-composer-ring">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
          rows={2}
          aria-label={t("code.launch.promptAria")}
          placeholder={t("code.launch.placeholder")}
          className="w-full resize-none bg-transparent text-[14px] text-ink placeholder:text-ink-tertiary focus:outline-none"
        />
        <div className="flex items-center gap-2">
          <select
            aria-label={t("code.launch.engine")}
            value={engine}
            onChange={(e) => setEngine(e.target.value)}
            className="rounded-md bg-transparent px-1 py-0.5 text-[12.5px] text-ink-secondary hover:bg-hover focus:outline-none"
          >
            {RUN_ENGINES.map((value) => <option key={value} value={value}>{ENGINE_LABEL[value]}</option>)}
          </select>
          <input
            aria-label={t("code.launch.model")}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-44 rounded-md bg-transparent px-1 py-0.5 text-[12.5px] text-ink-secondary hover:bg-hover focus:bg-hover focus:outline-none"
          />
          <span className="flex-1" />
          <button
            type="button"
            onClick={submit}
            disabled={!prompt.trim() || busy}
            aria-label={t("code.launch.submit")}
            title={t("code.launch.submit")}
            className="flex size-8 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-40"
          >
            {busy ? <Loader2 size={15} aria-hidden className="animate-spin motion-reduce:animate-none" /> : <ArrowUp size={16} aria-hidden />}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {(["audit", "tests", "docs"] as const).map((chip) => (
          <button key={chip} type="button" onClick={() => setPrompt(t(`code.chip.${chip}.prompt`))} className="rounded-full border border-hairline px-3 py-1 text-[12.5px] text-ink-secondary hover:bg-hover hover:text-ink">
            {t(`code.chip.${chip}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
