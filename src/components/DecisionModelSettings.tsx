// Settings > Models > Fast decisions (was "Decision model"). One master switch, the Jev key (write-only:
// the server reports configured-or-not, never the value), and one switch per
// thing it decides. Saving a key turns it on; there is no confirm step. The
// packaged desktop keeps the key in its OS-encrypted store; elsewhere it goes
// to the server's own 0600 config, like every other workspace key. On a Cloud
// Pro home Jev is included: it works with no key, there is nothing to clear,
// and a key pasted here replaces it.
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { CompactRow, DescribedRow, FoldRow, HelpTip, PILL, SettingsGroup, Switch } from "./SettingsPrimitives";
import { ExternalLinkPill, StatusText } from "./settings/SettingsPatterns";
import { readableError } from "@/lib/plain-error";

const KEY_URL = "https://typesafe.ai";

type TestResult = { ok: true; latencyMs: number } | { ok: false; reason: string; status?: number };

const FAILURES: Record<string, LocaleKey> = {
  rejected: "decider.error.rejected",
  unreachable: "decider.error.unreachable",
  timeout: "decider.error.timeout",
  rate_limited: "decider.error.rateLimited",
  overloaded: "decider.error.overloaded",
  malformed: "decider.error.malformed",
  no_key: "decider.error.noKey",
  misconfigured: "decider.error.misconfigured",
};

/** A test of Cloud Pro's included decisions has no key to check at
 * typesafe.ai: its relay refuses a subscription that is not active (402) and
 * a month's decisions that are used up (429). */
const INCLUDED_FAILURES: Record<string, LocaleKey> = {
  rejected: "decider.included.error.rejected",
  rate_limited: "decider.included.error.limited",
};

/** A fixed sentence per failure: the vendor's own body never reaches the UI. */
export function deciderFailureText(result: { reason: string; status?: number }, included = false): string {
  if (included && result.reason === "http_error" && result.status === 402) return t("decider.included.error.subscription");
  if (included && INCLUDED_FAILURES[result.reason]) return t(INCLUDED_FAILURES[result.reason]!);
  if (result.reason === "http_error") return t("decider.error.http", { status: String(result.status ?? "?") });
  const key = FAILURES[result.reason];
  return key ? t(key) : t("decider.error.other");
}

/** Jobs that are not built yet: listed so people know what is coming, with
 * no switch, because a switch that does nothing would be a lie. */
const COMING_SOON: LocaleKey[] = ["decider.jobs.browserClicks", "decider.jobs.toolSelection", "decider.jobs.placement"];

export function DecisionModelSettings() {
  const { state, dispatch } = useStore();
  const decider = state.config?.decider;
  const configured = decider?.configured ?? false;
  // Cloud Pro's decisions, with no key saved: nothing to clear or replace.
  const included = configured && decider?.included === true;
  const ownKey = configured && !included;
  const enabled = decider?.enabled ?? false;
  const roomRouting = decider?.jobs.roomRouting ?? true;
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<{ ok: boolean; text: string } | null>(null);
  const draft = value.trim();
  const clearing = !draft && ownKey;

  const applied = (config: ConfigStatus) => dispatch({ type: "configStatus", config });

  const patch = async (decision: Record<string, unknown>) => {
    if (switching) return;
    setSwitching(true);
    setError(null);
    try {
      applied(await api<ConfigStatus>("/api/config", { method: "PUT", body: JSON.stringify({ decider: decision }) }));
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setSwitching(false);
    }
  };

  const save = async () => {
    if (saving || (!draft && !ownKey)) return;
    setSaving(true);
    setError(null);
    setVerdict(null);
    try {
      const status = window.ogb?.setCredential
        ? await window.ogb.setCredential("jevApiKey", draft)
        : await api<ConfigStatus>("/api/config", { method: "PUT", body: JSON.stringify({ decider: { key: draft } }) });
      applied(status);
      setValue("");
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (testing || saving || (!draft && !configured)) return;
    setTesting(true);
    setVerdict(null);
    setError(null);
    // With no draft, the server tests what is in use: Cloud Pro's included
    // decisions go through the Admin's relay, never to Jev directly.
    const testingIncluded = !draft && included;
    try {
      const result = await api<TestResult>("/api/decider/test", { method: "POST", body: JSON.stringify(draft ? { key: draft } : {}) });
      setVerdict(result.ok
        ? { ok: true, text: t("decider.test.ok", { ms: String(result.latencyMs) }) }
        : { ok: false, text: deciderFailureText(result, testingIncluded) });
    } catch (cause) {
      setVerdict({ ok: false, text: readableError(cause) });
    } finally {
      setTesting(false);
    }
  };

  // #2080 (L1): "Jev" becomes "Fast decisions": one switch with its state
  // in grey, the key, the test and what it decides in a Details fold that
  // opens by itself while no key is saved (the switch needs one).
  const state_ = included ? t("keys.includedWithCloudPro") : configured ? t("decider.status.connected") : t("decider.masterNeedsKey");
  return (
    <div data-settings-card="engines.decisionModel">
      <SettingsGroup
        title={t("settings.section.decisionModel")}
        groupId="decisionModel"
        accessory={<HelpTip label={t("settings.moreAbout", { title: t("settings.section.decisionModel") })}>{t("decider.intro")}</HelpTip>}
      >
        <DescribedRow
          label={t("decider.master")}
          description={<span role="status"><StatusText tone={configured ? "success" : "neutral"}>{state_}</StatusText></span>}
          rowId="deciderMaster"
        >
          <Switch
            data-testid="decider-master"
            aria-label={t("decider.master")}
            checked={enabled}
            disabled={!configured || switching || !state.config}
            onClick={() => void patch({ enabled: !enabled })}
            className="cursor-pointer"
          />
        </DescribedRow>
        <FoldRow cardId="engines.decisionModel.details" defaultOpen={!configured} label={t("decider.details")} description={t("decider.detailsHelp")}>
          <div className="flex flex-col gap-1.5" data-decider-details="">
            <span className="text-[12px] font-medium text-ink-secondary">{t("decider.key.label")}</span>
            <div className="flex gap-2">
              <input
                type="password"
                value={value}
                onChange={(event) => { setVerdict(null); setError(null); setValue(event.target.value); }}
                onKeyDown={(event) => event.key === "Enter" && void save()}
                disabled={saving}
                placeholder={ownKey ? t("keys.replace") : t("decider.key.placeholder")}
                aria-label={t("decider.key.label")}
                autoComplete="off"
                spellCheck={false}
                className="w-full min-w-0 rounded-lg border border-hairline/40 bg-inset px-3 py-1.5 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
              />
              <button
                type="button"
                data-testid="decider-save"
                onClick={() => void save()}
                disabled={saving || (!draft && !ownKey)}
                title={clearing ? t("keys.removeKey") : t("common.save")}
                className={cn(PILL, "shrink-0 cursor-pointer disabled:cursor-not-allowed", clearing && "text-danger")}
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : clearing ? t("keys.clear") : <><Check size={13} />{t("common.save")}</>}
              </button>
              <button
                type="button"
                data-testid="decider-test"
                onClick={() => void test()}
                disabled={testing || saving || (!draft && !configured)}
                className={cn(PILL, "shrink-0 cursor-pointer disabled:cursor-not-allowed")}
              >
                {testing ? t("keys.testing") : t("keys.test")}
              </button>
            </div>
            {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
            {verdict && <p role="status" className={cn("text-[12px]", verdict.ok ? "text-success" : "text-danger")}>{verdict.text}</p>}
            <ExternalLinkPill href={KEY_URL} className="w-fit">{t("decider.key.getKey")}</ExternalLinkPill>
            <div className="-mx-3.5 mt-2 flex flex-col">
              <DescribedRow label={t("decider.jobs.roomRouting")} help={t("decider.jobs.roomRoutingDetail")} rowId="roomRouting">
                <Switch
                  data-testid="decider-job-roomRouting"
                  aria-label={t("decider.jobs.roomRouting")}
                  checked={enabled && roomRouting}
                  disabled={!enabled || switching}
                  onClick={() => void patch({ jobs: { roomRouting: !roomRouting } })}
                  className="cursor-pointer"
                />
              </DescribedRow>
              {COMING_SOON.map((label) => (
                <div key={label} data-testid="decider-coming-soon" aria-disabled="true">
                  <CompactRow label={t(label)} className="opacity-60">
                    <span className="text-[12px] text-ink-secondary">{t("decider.jobs.comingSoon")}</span>
                  </CompactRow>
                </div>
              ))}
            </div>
          </div>
        </FoldRow>
      </SettingsGroup>
    </div>
  );
}
