// Shared provider-key dialog used by Providers and image generation.
// Values stay write-only; rows expose configured state only.
import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { ArrowUpRight, ExternalLink, X } from "lucide-react";

import { useStore, type ConfigStatus } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import {
  ApiKeyRow,
  OpenAiCompatModel,
  OpenAiCompatUrl,
  OpenCodeProviderKeys,
  credentialCopy,
  type ConfigSection,
  type TestableProvider,
} from "../ApiKeys";
import { HelpTip } from "../SettingsPrimitives";
import { azureOpenAIEndpoint } from "../../../shared/azure-openai";

export type KeyRowId = "openai" | "anthropic" | "xai" | "elevenlabs" | "fishAudio" | "openaiImage" | "customImage" | "openrouter" | "mistral" | "azureFoundry" | "openaiCompat" | "opencodeGo";

/** The OpenAI-compatible connection points at an Azure resource: its key is
 * shown on the Azure row, not on "Other (OpenAI-compatible)". */
const compatOnAzure = (c: ConfigStatus) => azureOpenAIEndpoint(c.openaiCompat?.url) !== null;

/** Which key a row holds, its name and whether a key is saved. `included`:
 * works with no saved key (Cloud Pro). */
const ROWS: Record<KeyRowId, { section: ConfigSection; nameKey: LocaleKey; test?: TestableProvider; saved: (config: ConfigStatus) => boolean; included?: (config: ConfigStatus) => boolean }> = {
  anthropic: { section: "anthropic", nameKey: "providerKeys.anthropic", test: "anthropic", saved: (c) => c.anthropic?.configured ?? false },
  openai: { section: "openai", nameKey: "providerKeys.openai", test: "openai", saved: (c) => c.openai?.configured ?? false },
  xai: { section: "xai", nameKey: "providerKeys.xai", test: "xai", saved: (c) => c.xai?.configured ?? false },
  elevenlabs: { section: "elevenlabs", nameKey: "providerKeys.elevenlabs", saved: (c) => c.tts?.keys?.elevenlabs ?? false, included: (c) => c.tts?.included === true },
  fishAudio: { section: "fishAudio", nameKey: "providerKeys.fishAudio", saved: (c) => c.tts?.keys?.fish ?? false },
  openaiImage: { section: "openaiImage", nameKey: "providerKeys.openaiImage", saved: (c) => c.imageGen?.openaiConfigured === true },
  customImage: { section: "customImage", nameKey: "providerKeys.customImage", saved: (c) => c.imageGen?.customKeyConfigured === true },
  openrouter: { section: "openrouter", nameKey: "providerKeys.openrouter", test: "openrouter", saved: (c) => c.openrouter?.configured ?? false },
  mistral: { section: "mistral", nameKey: "providerKeys.mistral", test: "mistral", saved: (c) => c.mistral?.configured ?? false },
  // One connection, two rows: Azure AI Foundry / Azure OpenAI is the
  // OpenAI-compatible key and URL with an Azure resource's address.
  azureFoundry: { section: "azureFoundry", nameKey: "providerKeys.azureFoundry", test: "openaiCompat", saved: (c) => (c.openaiCompat?.configured ?? false) && compatOnAzure(c) },
  openaiCompat: { section: "openaiCompat", nameKey: "providerKeys.openaiCompat", test: "openaiCompat", saved: (c) => (c.openaiCompat?.configured ?? false) && !compatOnAzure(c) },
  opencodeGo: { section: "opencodeGo", nameKey: "providerKeys.opencode", saved: (c) => (c.opencodeGo?.configured ?? false) || (c.opencodeGo?.providerKeys?.length ?? 0) > 0 },
};
/** The keys most people need: the big model providers. Grok voice and Grok
 * images use the xAI key of this list. */
export const MAIN_KEY_ROWS = ["anthropic", "openai", "xai"] as const satisfies readonly KeyRowId[];
/** Rarer keys, under "More providers" until one is saved: a saved key is
 * always in the main list, never hidden. The voice keys (ElevenLabs, Fish
 * Audio) and the image keys are here too since 2026-10-15: one place for
 * every key, the Voice section and Image generation only lead to their row. */
export const MORE_KEY_ROWS = ["openrouter", "mistral", "azureFoundry", "openaiCompat", "opencodeGo", "elevenlabs", "fishAudio", "openaiImage", "customImage"] as const satisfies readonly KeyRowId[];

export function keyRowSaved(id: KeyRowId, config: ConfigStatus | null | undefined): boolean {
  return config ? ROWS[id].saved(config) : false;
}

/** The rows of the main list and of "More providers" for this config. */
export function keyRowName(id: KeyRowId): string {
  return t(ROWS[id].nameKey);
}

// The open dialog, in a module store so another page (an engine card's
// "Add the key", an old link to API keys) can open it before this page mounts.
let openRow: KeyRowId | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
export function openProviderKeyDialog(row: KeyRowId | null): void {
  openRow = row;
  emit();
}
function useOpenRow(): KeyRowId | null {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => openRow, () => openRow);
}

/** The key row open for editing, so Providers can expand that row. */
export function useOpenProviderKey(): KeyRowId | null {
  return useOpenRow();
}

/** The key line of a section that uses a key of the list (Voice, Image
 * generation): whether the chosen provider's key is saved, in a few words,
 * and when it is missing a link to its row in Keys, never a key field.
 * `link` is false where the Keys list is not shown (a remote window): the
 * line then only says what is missing. From Voice the link opens Models. */
export function KeyInKeys({ row, saved, included = false, optional = false, missing, link = true }: {
  row: KeyRowId;
  saved: boolean;
  /** Works with no saved key (ElevenLabs with Cloud Pro). */
  included?: boolean;
  /** The provider also works without a key (a keyless custom server). */
  optional?: boolean;
  /** The words when no key is saved; default "{name} key missing". */
  missing?: string;
  link?: boolean;
}) {
  const { dispatch } = useStore();
  const name = keyRowName(row);
  const ready = saved || included;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-key-in-keys={row} data-key-in-keys-saved={ready ? "true" : "false"}>
      <span className={cn("size-1.5 shrink-0 rounded-full", ready ? "bg-accent" : optional ? "bg-raised-hover" : "bg-warning")} aria-hidden="true" />
      <span className="min-w-0 flex-1 text-[12.5px] text-ink-secondary">
        {saved ? t("modelsVoice.key.uses", { name })
          : included ? t("keys.includedWithCloudPro")
          : missing ?? t("modelsVoice.key.missing", { name })}
      </span>
      {!ready && link && (
        <button
          type="button"
          data-add-in-keys={row}
          onClick={() => {
            // 2026-10-30: keys are on Providers; the link opens it with the
            // key's own dialog (the dialog waits for the page to mount)
            dispatch({ type: "toggleAppSettings", open: true, section: "providers" });
            openProviderKeyDialog(row);
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-md text-[12.5px] font-medium text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          {t("modelsVoice.key.addInKeys")}
          <ArrowUpRight size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** The key a key engine runs on, for an engine card's "Add the key". */
export function keyRowForEngine(driverKind: string, instanceId: string): KeyRowId | null {
  if (driverKind === "claudeAgent") return "anthropic";
  if (driverKind === "mistral" || instanceId.includes("mistral")) return "mistral";
  if (driverKind === "grok" || driverKind === "grokAgent" || instanceId.includes("xai")) return "xai";
  if (instanceId.includes("openrouter")) return "openrouter";
  if (driverKind === "opencodeGo") return "opencodeGo";
  if (instanceId.includes("openai-compat") || instanceId.includes("compat")) return "openaiCompat";
  if (driverKind === "codex" || instanceId.includes("openai")) return "openai";
  return null;
}

/** Mounted on Providers: the editor, unless that row already shows it inline.
 * `hidden` keeps this mount alive so leaving the row does not clear the request. */
export function ProviderKeyDialog({ hidden = false }: { hidden?: boolean }) {
  const open = useOpenRow();
  useEffect(() => () => openProviderKeyDialog(null), []);
  if (!open || hidden) return null;
  return <ProviderKeyEditor id={open} onClose={() => openProviderKeyDialog(null)} />;
}

/** Masked key field under the provider row (or under the list when the row
 * is not on this page). Paste, Enter or leaving the field saves. */
export function ProviderKeyEditor({ id, onClose }: { id: KeyRowId; onClose: () => void }) {
  const row = ROWS[id];
  const copy = credentialCopy(row.section);
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>("input")?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  let extra: ReactNode = null;
  if (id === "openaiCompat") extra = <><OpenAiCompatUrl /><OpenAiCompatModel /></>;
  if (id === "azureFoundry") extra = <><OpenAiCompatUrl azure /><OpenAiCompatModel azure /></>;
  if (id === "opencodeGo") {
    extra = (
      <>
        <div className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
          <span>{t("providerKeys.opencodeMore")}</span>
          <HelpTip label={t("providerKeys.opencodeMore")}>
            {t("keys.opencode.providersHint").split("{command}").flatMap((part, index) =>
              index === 0 ? [part] : [<code key={index} className="font-mono">opencode auth login</code>, part])}
          </HelpTip>
        </div>
        <OpenCodeProviderKeys />
      </>
    );
  }
  return (
    <div
      ref={ref}
      role="region"
      aria-labelledby={titleId}
      data-provider-key-dialog={id}
      className="flex flex-col gap-3 rounded-xl border-[0.5px] border-border bg-inset/40 p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-[13px] font-medium text-ink">{t(row.nameKey)}</h2>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="flex size-8 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink">
          <X size={16} />
        </button>
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-secondary">{copy.description}</p>
      <a href={copy.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 self-start text-[12.5px] font-medium text-accent hover:underline">
        {copy.linkLabel}
        <ExternalLink size={12} aria-hidden="true" />
      </a>
      <ApiKeyRow section={row.section} testProvider={row.test} bare />
      {extra}
      <div className="flex justify-end">
        <button type="button" onClick={onClose} className="rounded-lg bg-control px-4 py-1.5 text-[13px] text-ink hover:bg-raised-hover">
          {t("providerKeys.done")}
        </button>
      </div>
    </div>
  );
}
