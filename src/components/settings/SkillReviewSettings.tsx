import { useEffect, useRef, useState } from "react";

import {
  MAX_SKILL_REVIEW_STEPS,
  MIN_SKILL_REVIEW_STEPS,
  parseSkillReviewSteps,
  skillAuthoringEnabled,
  skillReviewSteps,
} from "@/lib/feature-flags";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";
import { canEditConfig, canManageExperimental } from "@/lib/viewer";
import { DescribedRow } from "../SettingsPrimitives";

/** The review threshold, under "Bots may write their own skills"
 * (server/skills/skill-review.ts). Whether a bot learns is the bot's own
 * switch on its Skills page (#2610), not an org switch here. */
export function SkillReviewSettings() {
  const { state, dispatch } = useStore();
  const authoring = skillAuthoringEnabled(state.config);
  const confirmedSteps = skillReviewSteps(state.config);
  const manage = canManageExperimental(state.config) || canEditConfig(state.config);
  const [value, setValue] = useState(String(confirmedSteps));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  useEffect(() => {
    if (!dirty) setValue(String(confirmedSteps));
  }, [confirmedSteps, dirty]);

  const save = async (features: { skillReviewSteps?: number }) => {
    if (inFlight.current || !manage) return false;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features }),
      });
      dispatch({ type: "configStatus", config });
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.experimental.error"));
      return false;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const saveSteps = async () => {
    if (!dirty) return;
    const steps = parseSkillReviewSteps(value);
    if (steps === null) {
      setError(t("settings.experimental.skillReviewStepsRange", { min: MIN_SKILL_REVIEW_STEPS, max: MAX_SKILL_REVIEW_STEPS }));
      return;
    }
    if (await save({ skillReviewSteps: steps })) setDirty(false);
  };

  // Shared rows in the Experimental card, next to "Bots may write their own
  // skills", not a hand-drawn row indented under it (JC 2026-11-07).
  return (
    <div data-testid="skill-review-settings" className="contents">
      {authoring ? (
        <DescribedRow
          label={t("settings.experimental.skillReviewSteps")}
          rowId="skillReviewSteps"
          description={error ? <span role="alert" className="text-danger">{error}</span> : undefined}
        >
          <div
            className={`flex w-[96px] items-center rounded-lg border bg-inset ${
              error ? "border-danger/60" : "border-hairline/40 focus-within:border-focus"
            }`}
          >
            <input
              id="skill-review-steps"
              type="number"
              min={MIN_SKILL_REVIEW_STEPS}
              max={MAX_SKILL_REVIEW_STEPS}
              step={1}
              inputMode="numeric"
              value={value}
              disabled={saving || !manage}
              aria-invalid={Boolean(error)}
              aria-label={t("settings.experimental.skillReviewSteps")}
              onChange={(event) => {
                setValue(event.target.value);
                setDirty(true);
                setError("");
              }}
              onBlur={() => void saveSteps()}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="min-w-0 flex-1 bg-transparent px-3 py-1.5 text-[14px] tabular-nums text-ink focus:outline-none"
            />
          </div>
        </DescribedRow>
      ) : null}
    </div>
  );
}
