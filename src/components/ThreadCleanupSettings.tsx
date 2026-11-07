import { useEffect, useRef, useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";
import { DescribedRow, SettingsGroup, Switch, UnitField } from "./SettingsPrimitives";

/** Server bounds from server/config.ts, mirrored here so the form can
 * reject out-of-range input before the round trip. */
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3650;
const DEFAULT_RETENTION_DAYS = 30;
const MIB = 1024 * 1024;
const MIN_CAP_BYTES = 256 * 1024;
const MAX_CAP_BYTES = 4 * 1024 * 1024 * 1024;
const DEFAULT_CAP_MIB = 50;

function parseDays(value: string): number | null {
  const days = Number(value);
  return Number.isInteger(days) && days >= MIN_RETENTION_DAYS && days <= MAX_RETENTION_DAYS ? days : null;
}

export function parseCapMib(value: string): number | null {
  const mib = Number(value);
  if (!Number.isFinite(mib)) return null;
  const bytes = Math.round(mib * MIB);
  // mibText shows at most two decimals, so accept only exact 0.25 MiB steps:
  // 0.251 would persist as 263193 bytes, redisplay as 0.25, and silently
  // shrink to 262144 on the next save.
  return bytes >= MIN_CAP_BYTES && bytes <= MAX_CAP_BYTES && bytes % MIN_CAP_BYTES === 0 ? bytes : null;
}

/** 52428800 → "50", 262144 → "0.25" — the input shows whole MiB when it can. */
function mibText(bytes: number): string {
  const mib = bytes / MIB;
  return String(Number.isInteger(mib) ? mib : Number(mib.toFixed(2)));
}

type Knob = "retention" | "cap";

/** One line for the collapsed card: what cleanup does today, or Off. */
export function threadCleanupSummary(retentionDays: number | null, capBytes: number | null): string {
  const parts = [
    ...(retentionDays !== null ? [t("settings.card.cleanupRetention", { days: retentionDays })] : []),
    ...(capBytes !== null ? [t("settings.card.cleanupCap", { size: mibText(capBytes) })] : []),
  ];
  return parts.length ? parts.join(" · ") : t("settings.card.off");
}

export function ThreadCleanupSettings() {
  const { state, dispatch } = useStore();
  const confirmedRetentionDays = state.config?.threads?.eventLogRetentionDays ?? null;
  const confirmedCapBytes = state.config?.threads?.eventLogMaxBytes ?? null;
  // a draft is the field the user is typing in; null means follow the server
  const [retentionDraft, setRetentionDraft] = useState<string | null>(null);
  const [capDraft, setCapDraft] = useState<string | null>(null);
  const [pending, setPending] = useState<Knob | null>(null);
  const [error, setError] = useState("");
  const [errorKnob, setErrorKnob] = useState<Knob | null>(null);
  const saving = useRef(false);

  const retentionValue = retentionDraft ?? (confirmedRetentionDays === null ? String(DEFAULT_RETENTION_DAYS) : String(confirmedRetentionDays));
  const capValue = capDraft ?? (confirmedCapBytes === null ? String(DEFAULT_CAP_MIB) : mibText(confirmedCapBytes));

  // a save from the other knob replaces the config object, so only drop the
  // draft that matches the value the server just confirmed
  useEffect(() => {
    if (retentionDraft !== null && confirmedRetentionDays !== null && String(confirmedRetentionDays) === retentionDraft) setRetentionDraft(null);
  }, [confirmedRetentionDays, retentionDraft]);
  useEffect(() => {
    if (capDraft !== null && confirmedCapBytes !== null && mibText(confirmedCapBytes) === capDraft) setCapDraft(null);
  }, [confirmedCapBytes, capDraft]);

  const save = async (patch: { eventLogRetentionDays?: number | null; eventLogMaxBytes?: number | null }, knob: Knob) => {
    if (saving.current) return;
    saving.current = true;
    setPending(knob);
    setError("");
    setErrorKnob(null);
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ threads: patch }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.threadCleanup.error"));
    } finally {
      saving.current = false;
      setPending(null);
    }
  };

  const toggleRetention = (enabled: boolean) => {
    if (!enabled) {
      setRetentionDraft(null);
      setError("");
      setErrorKnob(null);
      void save({ eventLogRetentionDays: null }, "retention");
      return;
    }
    const days = parseDays(retentionValue);
    if (days === null) {
      setError(t("settings.threadCleanup.invalidRetention"));
      setErrorKnob("retention");
      return;
    }
    void save({ eventLogRetentionDays: days }, "retention");
  };

  const toggleCap = (enabled: boolean) => {
    if (!enabled) {
      setCapDraft(null);
      setError("");
      setErrorKnob(null);
      void save({ eventLogMaxBytes: null }, "cap");
      return;
    }
    const bytes = parseCapMib(capValue);
    if (bytes === null) {
      setError(t("settings.threadCleanup.invalidCap"));
      setErrorKnob("cap");
      return;
    }
    void save({ eventLogMaxBytes: bytes }, "cap");
  };

  const commitRetention = () => {
    if (confirmedRetentionDays === null) return;
    const days = parseDays(retentionValue);
    if (days === null) {
      setError(t("settings.threadCleanup.invalidRetention"));
      setErrorKnob("retention");
      return;
    }
    if (days === confirmedRetentionDays) {
      setRetentionDraft(null);
      setError("");
      return;
    }
    void save({ eventLogRetentionDays: days }, "retention");
  };

  const commitCap = () => {
    if (confirmedCapBytes === null) return;
    const bytes = parseCapMib(capValue);
    if (bytes === null) {
      setError(t("settings.threadCleanup.invalidCap"));
      setErrorKnob("cap");
      return;
    }
    if (bytes === confirmedCapBytes) {
      setCapDraft(null);
      setError("");
      return;
    }
    void save({ eventLogMaxBytes: bytes }, "cap");
  };

  // 0.5.6: the reference design's rows under the page's "Event log cleanup"
  // heading. Each knob is a switch with its value beside it; the one grey
  // line says what is never deleted, the errors take its place.
  return (
    <SettingsGroup title={t("settings.threadCleanup.title")} groupId="threadCleanup">
      <div data-settings-card="general.threadCleanup" data-thread-cleanup={threadCleanupSummary(confirmedRetentionDays, confirmedCapBytes)}>
        <DescribedRow
          label={t("settings.threadCleanup.retention.enable")}
          rowId="retention"
          description={errorKnob === "retention"
            ? <span id="thread-log-retention-error" role="alert" className="text-danger">{error}</span>
            : t("settings.threadCleanup.never")}
        >
          <UnitField
            id="thread-log-retention-days"
            value={retentionValue}
            unit={t("settings.threadCleanup.retention.unit")}
            label={t("settings.threadCleanup.retention.enable")}
            min={MIN_RETENTION_DAYS}
            max={MAX_RETENTION_DAYS}
            disabled={confirmedRetentionDays === null || pending !== null}
            invalid={errorKnob === "retention"}
            describedBy={errorKnob === "retention" ? "thread-log-retention-error" : undefined}
            onChange={(value) => {
              setRetentionDraft(value);
              setError("");
              setErrorKnob(null);
            }}
            onCommit={commitRetention}
          />
          <Switch
            id="thread-log-retention-enabled"
            checked={confirmedRetentionDays !== null}
            disabled={pending !== null}
            aria-label={t("settings.threadCleanup.retention.enable")}
            onClick={() => toggleRetention(confirmedRetentionDays === null)}
          />
        </DescribedRow>
        <DescribedRow
          label={t("settings.threadCleanup.cap.enable")}
          rowId="cap"
          description={errorKnob === "cap"
            ? <span id="thread-log-cap-error" role="alert" className="text-danger">{error}</span>
            : error && errorKnob === null
              ? <span role="alert" className="text-danger">{error}</span>
              : pending !== null ? <span role="status">{t("settings.threadCleanup.saving")}</span> : undefined}
        >
          <UnitField
            id="thread-log-cap-mib"
            value={capValue}
            unit={t("settings.threadCleanup.cap.unit")}
            label={t("settings.threadCleanup.cap.enable")}
            min={MIN_CAP_BYTES / MIB}
            max={MAX_CAP_BYTES / MIB}
            step={0.25}
            decimal
            disabled={confirmedCapBytes === null || pending !== null}
            invalid={errorKnob === "cap"}
            describedBy={errorKnob === "cap" ? "thread-log-cap-error" : undefined}
            onChange={(value) => {
              setCapDraft(value);
              setError("");
              setErrorKnob(null);
            }}
            onCommit={commitCap}
          />
          <Switch
            id="thread-log-cap-enabled"
            checked={confirmedCapBytes !== null}
            disabled={pending !== null}
            aria-label={t("settings.threadCleanup.cap.enable")}
            onClick={() => toggleCap(confirmedCapBytes === null)}
          />
        </DescribedRow>
      </div>
    </SettingsGroup>
  );
}
