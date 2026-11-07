// Settings > Experimental (#2093 / #2080): a list of switches and nothing else.
// One row = a label, a consequence line, a switch. Features this server
// cannot run sit under "Needs a server update". Developer pods sit under
// "Developer". Decision model lives only on Models (its own master switch).
// #2080 L3: built-in browser and My Chrome live on Computer.
// #2080: phone calls live on Voice (same read-only card for every org member).
import { Fragment, useEffect, useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { dataWindowEnabled, llmThreadTitlesEnabled, meetingNotetakerEnabled, skillAuthoringEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { LocaleKey } from "@/locales";
import { DescribedRow, HelpTip, SettingsGroup, Switch } from "../SettingsPrimitives";
import { setDevPodsEnabled, useDevPodPrefs } from "../dev-pods/prefs";
import { canManageExperimental } from "@/lib/viewer";
import { useServerFeature } from "@/lib/server-features";
import { featureMissingOnServer } from "@/lib/server-route";
import { isPersonalFeature } from "../../../shared/person-settings";
import { SkillReviewSettings } from "./SkillReviewSettings";

type ExperimentalFeature = "skillAuthoring" | "dataWindow" | "meetingNotetaker" | "llmThreadTitles";

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
  note?: React.ReactNode;
  busy: boolean;
  locked?: boolean;
  onToggle: () => void;
  below?: React.ReactNode;
}) {
  return (
    <div data-experimental-feature={feature} data-unavailable={unavailable ? "" : undefined} className={cn(unavailable && "[&_[id]]:text-ink-secondary")}>
      <DescribedRow
        label={label}
        description={unavailable ? t("settings.experimental.unavailable") : locked ? t("settings.experimental.orgLocked") : note}
        rowId={feature}
        below={below}
      >
        {unavailable && reason && <HelpTip label={t("settings.moreAbout", { title: label })}>{reason}</HelpTip>}
        <Switch
          checked={checked}
          aria-label={t(ariaKey)}
          disabled={busy || locked || (unavailable && !checked)}
          onClick={onToggle}
          className="disabled:cursor-not-allowed disabled:opacity-40"
        />
      </DescribedRow>
    </div>
  );
}

/** Unserved feature: listed under Needs a server update, no switch. */
function UnavailableRow({
  feature,
  label,
  reason,
}: {
  feature: ExperimentalFeature;
  label: string;
  reason: React.ReactNode;
}) {
  return (
    <div data-experimental-feature={feature} data-unavailable="" className={cn("[&_[id]]:text-ink-secondary")}>
      <DescribedRow
        label={label}
        description={t("settings.experimental.unavailable")}
        rowId={feature}
      >
        <HelpTip label={t("settings.moreAbout", { title: label })}>{reason}</HelpTip>
      </DescribedRow>
    </div>
  );
}

export function ExperimentalSettings() {
  const { state, dispatch } = useStore();
  const skillAuthoring = skillAuthoringEnabled(state.config);
  const dataWindow = dataWindowEnabled(state.config);
  const dataWindowServed = typeof state.config?.features?.dataWindow === "boolean";
  const meetingNotetaker = meetingNotetakerEnabled(state.config);
  const meetingNotetakerServed = typeof state.config?.features?.meetingNotetaker === "boolean";
  // #1098 (2026-10-27): on an organization server a person sets their own
  // switches (skill authoring, the Data window, generated titles) with no
  // right to edit the installation (/api/me/experimental). The meeting
  // notetaker stays the installation's (server.experimental).
  const manage = canManageExperimental(state.config);
  const personalServed = useServerFeature("memberPersonSettings") !== "no";
  const personal = state.config?.personalSettings === true && personalServed;
  const personalMissing = state.config?.personalSettings === true && !personalServed && !manage;
  // 2026-10-26 (owner): generated conversation titles were on only after a
  // hand edit of config.json; they get their switch here.
  const llmThreadTitles = llmThreadTitlesEnabled(state.config);
  const llmThreadTitlesServed = typeof state.config?.features?.llmThreadTitles === "boolean";
  const [saving, setSaving] = useState<ExperimentalFeature | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    api<ConfigStatus>("/api/config").then((config) => { if (live) dispatch({ type: "configStatus", config }); }, () => {});
    return () => { live = false; };
  }, [dispatch]);

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
  const devPods = useDevPodPrefs().enabled;

  type MainRow = {
    feature: ExperimentalFeature;
    label: LocaleKey;
    aria: LocaleKey;
    description: LocaleKey;
    checked: boolean;
    unavailable?: boolean;
    reason?: React.ReactNode;
    note?: React.ReactNode;
    below?: React.ReactNode;
    /** Rows of its own right after this one, in the same card. */
    after?: React.ReactNode;
  };
  const main: MainRow[] = [
    {
      feature: "skillAuthoring",
      label: "settings.experimental.skillAuthoring",
      aria: "settings.experimental.skillAuthoringAria",
      description: "settings.experimental.skillAuthoringDescription",
      checked: skillAuthoring,
      after: <SkillReviewSettings />,
    },
  ];
  const unavailable: Array<{ feature: ExperimentalFeature; label: LocaleKey; reason: React.ReactNode }> = [];

  if (dataWindowServed) {
    main.push({
      feature: "dataWindow",
      label: "settings.experimental.dataWindow",
      aria: "settings.experimental.dataWindowAria",
      description: "settings.experimental.dataWindowDescription",
      checked: dataWindow,
    });
  } else {
    unavailable.push({
      feature: "dataWindow",
      label: "settings.experimental.dataWindow",
      reason: t("settings.experimental.dataWindowServerOld"),
    });
  }

  if (meetingNotetakerServed) {
    main.push({
      feature: "meetingNotetaker",
      label: "settings.experimental.meetingNotetaker",
      aria: "settings.experimental.meetingNotetakerAria",
      description: "settings.experimental.meetingNotetakerHint",
      checked: meetingNotetaker,
    });
  } else {
    unavailable.push({
      feature: "meetingNotetaker",
      label: "settings.experimental.meetingNotetaker",
      reason: t("settings.experimental.meetingNotetakerServerOld"),
    });
  }

  if (llmThreadTitlesServed) {
    main.push({
      feature: "llmThreadTitles",
      label: "settings.experimental.llmThreadTitles",
      aria: "settings.experimental.llmThreadTitlesAria",
      description: "settings.experimental.llmThreadTitlesDescription",
      checked: llmThreadTitles,
    });
  } else {
    unavailable.push({
      feature: "llmThreadTitles",
      label: "settings.experimental.llmThreadTitles",
      reason: t("settings.experimental.serverOld"),
    });
  }

  const on = main.reduce((sum, row) => sum + Number(row.checked), 0);
  const total = main.length;

  return (
    <div data-settings-card="experimental.features" className="flex flex-col gap-2">
      <SettingsGroup
        groupId="experimental"
        title={t("settings.experimental.features")}
        accessory={<span className="min-w-0 truncate text-[13px] leading-[18px] text-ink-secondary" data-experimental-count="">· {t("settings.card.countOn", { count: on, total })}</span>}
      >
        {main.map((row) => (
          <Fragment key={row.feature}>
            <FeatureRow
              feature={row.feature}
              label={t(row.label)}
              ariaKey={row.aria}
              checked={row.checked}
              unavailable={row.unavailable}
              reason={row.reason}
              note={row.note ?? t(row.description)}
              busy={busy}
              locked={!mayToggle(row.feature)}
              onToggle={() => void toggle(row.feature, !row.checked)}
              below={row.below}
            />
            {row.after}
          </Fragment>
        ))}
      </SettingsGroup>

      {/* JC 2026-11-07: every group is a grey heading over one card of
          shared rows, as General; no loose fold row with a round chevron. */}
      {unavailable.length > 0 && (
        <div data-settings-card="experimental.needsServerUpdate">
          <SettingsGroup groupId="experimental.needsServerUpdate" title={t("settings.experimental.needsServerUpdate")}>
            <div data-experimental-needs-server="" className="flex flex-col">
              {unavailable.map((row) => (
                <UnavailableRow key={row.feature} feature={row.feature} label={t(row.label)} reason={row.reason} />
              ))}
            </div>
          </SettingsGroup>
        </div>
      )}

      <div data-settings-card="experimental.developer">
        <SettingsGroup groupId="experimental.developer" title={t("settings.experimental.developer")}>
          <div data-experimental-feature="devPods">
            <DescribedRow
              label={t("settings.experimental.devPods")}
              description={t("settings.experimental.devPodsDescription")}
              rowId="devPods"
            >
              <Switch checked={devPods} aria-label={t("settings.experimental.devPodsAria")} onClick={() => setDevPodsEnabled(!devPods)} />
            </DescribedRow>
          </div>
        </SettingsGroup>
      </div>

      {personalMissing && <p role="note" data-needs-server-update="" className="px-1 text-[12px] text-ink-secondary">{t("serverRoute.needsUpdate")}</p>}
      {error ? <p role="alert" className="px-1 text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}
