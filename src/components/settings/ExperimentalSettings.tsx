// Settings > Experimental, laid out as the reference design's settings pages (0.5.6,
//): one group, each feature a row with its label and a switch. A feature
// this server cannot run keeps its row, greyed, with "Not available on this
// server" (the Data window on a server older than 0.5.3, #539/#560) and the
// reason behind the help button.
// Routines in the conversation and Group turns are Organization's
// (2026-10-15): one way to reach them, no second switch here.
// #2080 L3: built-in browser and My Chrome live on Computer.
import { useEffect, useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { dataWindowEnabled, decisionModelEnabled, llmThreadTitlesEnabled, meetingNotetakerEnabled, skillAuthoringEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { LocaleKey } from "@/locales";
import { DescribedRow, HelpTip, SettingsGroup, Switch } from "../SettingsPrimitives";
import { setDevPodsEnabled, useDevPodPrefs } from "../dev-pods/prefs";
import { canManageExperimental } from "@/lib/viewer";
import { useServerFeature } from "@/lib/server-features";
import { featureMissingOnServer } from "@/lib/server-route";
import { isPersonalFeature } from "../../../shared/person-settings";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { OrgPhoneCalls } from "./OrgPhoneCalls";
import { SkillReviewSettings } from "./SkillReviewSettings";

type ExperimentalFeature = "skillAuthoring" | "decisionModel" | "dataWindow" | "meetingNotetaker" | "llmThreadTitles";

/** One feature: its label, and a grey "Not available on this server" line
 * with the reason on demand when the server cannot run it. */
function FeatureRow({
  feature,
  label,
  ariaKey,
  checked,
  unavailable,
  reason,
  note,
  busy,
  locked,
  onToggle,
  below,
}: {
  feature: ExperimentalFeature;
  label: string;
  ariaKey: LocaleKey;
  checked: boolean;
  unavailable?: boolean;
  reason?: React.ReactNode;
  /** A short grey line for an available feature that still needs a step. */
  note?: React.ReactNode;
  busy: boolean;
  /** The installation's switch, for someone who may not change it (#1098). */
  locked?: boolean;
  onToggle: () => void;
  below?: React.ReactNode;
}) {
  return (
    <div data-experimental-feature={feature} data-unavailable={unavailable ? "" : undefined} className={cn(unavailable && "[&_[id]]:text-ink-secondary")}>
      <DescribedRow
        label={label}
        description={unavailable ? t("settings.experimental.unavailable") : locked ? t("settings.experimental.serverSetting") : note}
        rowId={feature}
        below={below}
      >
        {unavailable && reason && <HelpTip label={t("settings.moreAbout", { title: label })}>{reason}</HelpTip>}
        <Switch
          checked={checked}
          aria-label={t(ariaKey)}
          // a feature already on can always be turned off
          disabled={busy || locked || (unavailable && !checked)}
          onClick={onToggle}
          className="disabled:cursor-not-allowed disabled:opacity-40"
        />
      </DescribedRow>
    </div>
  );
}

export function ExperimentalSettings() {
  const { state, dispatch } = useStore();
  const skillAuthoring = skillAuthoringEnabled(state.config);
  const decisionModel = decisionModelEnabled(state.config);
  const dataWindow = dataWindowEnabled(state.config);
  // A server that predates the Data window (Sagax 0.5.2 and earlier, e.g. an
  // organization server not updated yet) sends no dataWindow and refuses to
  // save one: the row stays, greyed.
  const dataWindowServed = typeof state.config?.features?.dataWindow === "boolean";
  const meetingNotetaker = meetingNotetakerEnabled(state.config);
  // A server without the notetaker sends no meetingNotetaker: the row stays, greyed.
  const meetingNotetakerServed = typeof state.config?.features?.meetingNotetaker === "boolean";
  // #1098 (2026-10-27): on an organization server a person sets their own
  // switches (skill authoring, the Data window, generated titles) with no
  // right to edit the installation (/api/me/experimental). The meeting
  // notetaker stays the installation's (server.experimental).
  const manage = canManageExperimental(state.config);
  // An older server refuses a member's own switches (shared/server-features.ts):
  // they show the server's state, locked, with the neutral line.
  const personalServed = useServerFeature("memberPersonSettings") !== "no";
  const personal = state.config?.personalSettings === true && personalServed;
  const personalMissing = state.config?.personalSettings === true && !personalServed && !manage;
  // 2026-10-26 (owner): generated conversation titles were on only after a
  // hand edit of config.json; they get their switch here.
  const llmThreadTitles = llmThreadTitlesEnabled(state.config);
  const llmThreadTitlesServed = typeof state.config?.features?.llmThreadTitles === "boolean";
  // Phone calls (pilot) is the organization's, an admin's: the server answers
  // members 403, so only an organization admin sees it (who may change it is
  // unchanged by its move here).
  const orgAdmin = usePerspicaxOrg()?.viewerRole === "admin";
  const [saving, setSaving] = useState<ExperimentalFeature | null>(null);
  const [error, setError] = useState("");

  // The switches show the server's saved state, read again when this page
  // opens: never a copy this page kept from earlier.
  useEffect(() => {
    let live = true;
    api<ConfigStatus>("/api/config").then((config) => { if (live) dispatch({ type: "configStatus", config }); }, () => {});
    return () => { live = false; };
  }, [dispatch]);

  // Who may flip a row: the installation's switches need server.experimental;
  // a personal one is also the person's own on an organization server.
  const mayToggle = (feature: ExperimentalFeature) => manage || (personal && isPersonalFeature(feature));
  const toggle = async (feature: ExperimentalFeature, next: boolean) => {
    if (saving || !mayToggle(feature)) return;
    setSaving(feature);
    setError("");
    try {
      if (!manage) {
        await api("/api/me/experimental", { method: "PATCH", body: JSON.stringify({ features: { [feature]: next } }) });
        dispatch({ type: "configStatus", config: await api<ConfigStatus>("/api/config") });
        return;
      }
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features: { [feature]: next } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      if (featureMissingOnServer("memberPersonSettings", cause)) return;
      setError(cause instanceof Error ? cause.message : t("settings.experimental.error"));
    } finally {
      setSaving(null);
    }
  };
  const busy = saving !== null;
  // The dev context pods are this computer's own choice: no server round trip.
  const devPods = useDevPodPrefs().enabled;
  const on = Number(skillAuthoring) + Number(decisionModel) + Number(dataWindow) + Number(meetingNotetaker) + Number(devPods)
    + Number(llmThreadTitles);

  return (
    <div data-settings-card="experimental.features" className="flex flex-col gap-2">
      <SettingsGroup
        title={t("settings.experimental.title")}
        groupId="experimental"
        accessory={<span className="min-w-0 truncate text-[13px] leading-[18px] text-ink-secondary" data-experimental-count="">· {t("settings.card.countOn", { count: on, total: 6 })}</span>}
      >
        <FeatureRow
          feature="skillAuthoring"
          label={t("settings.experimental.skillAuthoring")}
          ariaKey="settings.experimental.skillAuthoringAria"
          checked={skillAuthoring}
          busy={busy}
          locked={!mayToggle("skillAuthoring")}
          onToggle={() => void toggle("skillAuthoring", !skillAuthoring)}
          below={<SkillReviewSettings />}
        />
        <FeatureRow
          feature="decisionModel"
          label={t("settings.experimental.decisionModel")}
          ariaKey="settings.experimental.decisionModel"
          checked={decisionModel}
          busy={busy}
          locked={!mayToggle("decisionModel")}
          onToggle={() => void toggle("decisionModel", !decisionModel)}
        />
        <FeatureRow
          feature="dataWindow"
          label={t("settings.experimental.dataWindow")}
          ariaKey="settings.experimental.dataWindowAria"
          checked={dataWindow}
          unavailable={!dataWindowServed}
          reason={t("settings.experimental.dataWindowServerOld")}
          busy={busy}
          locked={!mayToggle("dataWindow")}
          onToggle={() => void toggle("dataWindow", !dataWindow)}
        />
        <FeatureRow
          feature="meetingNotetaker"
          label={t("settings.experimental.meetingNotetaker")}
          ariaKey="settings.experimental.meetingNotetakerAria"
          checked={meetingNotetaker}
          unavailable={!meetingNotetakerServed}
          reason={t("settings.experimental.meetingNotetakerServerOld")}
          note={t("settings.experimental.meetingNotetakerHint")}
          busy={busy}
          locked={!mayToggle("meetingNotetaker")}
          onToggle={() => void toggle("meetingNotetaker", !meetingNotetaker)}
        />
        <FeatureRow
          feature="llmThreadTitles"
          label={t("settings.experimental.llmThreadTitles")}
          ariaKey="settings.experimental.llmThreadTitlesAria"
          checked={llmThreadTitles}
          unavailable={!llmThreadTitlesServed}
          reason={t("settings.experimental.serverOld")}
          busy={busy}
          locked={!mayToggle("llmThreadTitles")}
          onToggle={() => void toggle("llmThreadTitles", !llmThreadTitles)}
        />
        <div data-experimental-feature="devPods">
          <DescribedRow label={t("settings.experimental.devPods")} rowId="devPods">
            <Switch checked={devPods} aria-label={t("settings.experimental.devPodsAria")} onClick={() => setDevPodsEnabled(!devPods)} />
          </DescribedRow>
        </div>
        {orgAdmin && <OrgPhoneCalls />}
      </SettingsGroup>
      {personalMissing && <p role="note" data-needs-server-update="" className="px-1 text-[12px] text-ink-secondary">{t("serverRoute.needsUpdate")}</p>}
      {error ? <p role="alert" className="px-1 text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}
