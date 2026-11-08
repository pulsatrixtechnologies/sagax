// Settings > Developer > Experimental features (#2729, JC 2026-11-08: « Move
// experimental into developer »; was its own page, #2093 / #2080): a card of
// switches and nothing else. One row = a label, a consequence line, a switch.
// A feature this server cannot run is not shown (hiddenWhenUnavailable).
// Context pods are a card of Developer too (#2636). Decision model lives only on Models (its own master switch).
// #2080 L3: built-in browser and My Chrome live on Computer.
// #2080: phone calls live on Voice (same read-only card for every org member).
import { Fragment, useEffect, useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { dataWindowEnabled, llmThreadTitlesEnabled, meetingNotetakerEnabled, skillAuthoringEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { DescribedRow, SettingsGroup, Switch } from "../SettingsPrimitives";
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
  note,
  busy,
  onToggle,
  below,
}: {
  feature: ExperimentalFeature;
  label: string;
  ariaKey: LocaleKey;
  checked: boolean;
  note?: React.ReactNode;
  busy: boolean;
  onToggle: () => void;
  below?: React.ReactNode;
}) {
  return (
    <div data-experimental-feature={feature}>
      <DescribedRow label={label} description={note} rowId={feature} below={below}>
        <Switch
          checked={checked}
          aria-label={t(ariaKey)}
          disabled={busy}
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

  type MainRow = {
    feature: ExperimentalFeature;
    label: LocaleKey;
    aria: LocaleKey;
    description: LocaleKey;
    checked: boolean;
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

  if (dataWindowServed) {
    main.push({
      feature: "dataWindow",
      label: "settings.experimental.dataWindow",
      aria: "settings.experimental.dataWindowAria",
      description: "settings.experimental.dataWindowDescription",
      checked: dataWindow,
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
  }

  if (llmThreadTitlesServed) {
    main.push({
      feature: "llmThreadTitles",
      label: "settings.experimental.llmThreadTitles",
      aria: "settings.experimental.llmThreadTitlesAria",
      description: "settings.experimental.llmThreadTitlesDescription",
      checked: llmThreadTitles,
    });
  }

  // #2729: a switch this viewer may not flip (the installation's, on an
  // organization server) is not shown, never greyed (hiddenWhenUnavailable).
  const rows = main.filter((row) => mayToggle(row.feature));
  const on = rows.reduce((sum, row) => sum + Number(row.checked), 0);
  const total = rows.length;
  if (total === 0 && !personalMissing && !error) return null;

  return (
    <div data-settings-card="experimental.features" className="flex flex-col gap-2">
      {total > 0 && (
      <SettingsGroup
        groupId="experimental"
        title={t("settings.experimental.title")}
        accessory={<span className="min-w-0 truncate text-[13px] leading-[18px] text-ink-secondary" data-experimental-count="">· {t("settings.card.countOn", { count: on, total })}</span>}
      >
        {rows.map((row) => (
          <Fragment key={row.feature}>
            <FeatureRow
              feature={row.feature}
              label={t(row.label)}
              ariaKey={row.aria}
              checked={row.checked}
              note={row.note ?? t(row.description)}
              busy={busy}
              onToggle={() => void toggle(row.feature, !row.checked)}
              below={row.below}
            />
            {row.after}
          </Fragment>
        ))}
      </SettingsGroup>
      )}
      {personalMissing && <p role="note" data-needs-server-update="" className="px-1 text-[12px] text-ink-secondary">{t("serverRoute.needsUpdate")}</p>}
      {error ? <p role="alert" className="px-1 text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}
