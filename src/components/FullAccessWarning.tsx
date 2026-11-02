import { TriangleAlert } from "lucide-react";

import { t } from "@/lib/i18n";
import { ConfirmDialog } from "./ConfirmDialog";

/** English source of the bot-scope warning. The dialog renders `t("fullAccessWarning.body")`. */
export const FULL_ACCESS_WARNING =
  "This bot can read, edit, delete files, use the internet, and control its selected computer without asking, even for potentially destructive or sensitive actions. This also applies to scheduled work and tasks delegated by your Primary Bot or other bots. It does not enable Full access on other bots. Some providers may still require approval. Questions and separate Sagax confirmations still wait for you. This does not grant operating-system permissions or access to accounts you have not connected.";

export function FullAccessWarning({
  open,
  onCancel,
  onConfirm,
  scope = "bot",
  allThreads,
  onAllThreadsChange,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** `organization`: an organization server, confirmed once per bot. */
  scope?: "bot" | "thread" | "organization";
  allThreads?: boolean;
  onAllThreadsChange?: (value: boolean) => void;
}) {
  const body =
    scope === "thread"
      ? t("fullAccessWarning.thread")
      : scope === "organization"
        ? t("fullAccessWarning.org")
        : t("fullAccessWarning.body");

  const extra =
    scope === "bot" && onAllThreadsChange ? (
      <label className="flex items-start gap-2 text-[13px] text-ink">
        <input
          type="checkbox"
          className="mt-0.5 accent-accent"
          checked={Boolean(allThreads)}
          onChange={(event) => onAllThreadsChange(event.target.checked)}
        />
        <span>
          {t("fullAccessWarning.applyAll")}
          <span className="mt-1 block text-ink-secondary">{t("fullAccessWarning.applyHint")}</span>
        </span>
      </label>
    ) : undefined;

  return (
    <ConfirmDialog
      open={open}
      tone="danger"
      icon={<TriangleAlert size={19} />}
      title={t("fullAccessWarning.title")}
      body={body}
      confirmLabel={t("fullAccessWarning.confirm")}
      extra={extra}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
