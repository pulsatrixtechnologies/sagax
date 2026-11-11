import { BellOff } from "lucide-react";
import { activeLocale, t } from "@/lib/i18n";
import { useStoreDispatch } from "@/state/store-selector";
import { quietModeCounts, quietModeLanguage } from "../../shared/quiet-mode";
import { ASK_QUIET_BUTTON, AskSettledLine } from "./AskCard";

/** #3480: the line a bot's chat gets when its quiet mode goes off: how many
 * runs it kept quiet and how many had problems, drawn like an answered card,
 * with the link that opens those runs in the main area (Automations, this
 * bot's runs). */
export function QuietModeLine({ kept, botId }: {
  kept: { runs: number; problems: number };
  botId: string;
}) {
  const dispatch = useStoreDispatch();
  const text = quietModeCounts(kept, quietModeLanguage(activeLocale()));
  const open = t("quietMode.summary.open");
  return (
    <div data-quiet-mode-line="">
      <AskSettledLine
        icon={<BellOff size={13} />}
        ariaLabel={text}
        action={kept.runs > 0 ? (
          <button
            type="button"
            data-quiet-mode-runs=""
            className={ASK_QUIET_BUTTON}
            onClick={() => dispatch({ type: "showRoutines", section: "logs", botId })}
          >
            {open}
          </button>
        ) : undefined}
      >
        {text}
      </AskSettledLine>
    </div>
  );
}
