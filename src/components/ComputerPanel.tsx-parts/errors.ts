import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { readableError } from "@/lib/plain-error";

/** Keep local failure copy translatable while it remains in panel state. */
export class LocalizedPanelError extends Error {
  constructor(
    readonly key: LocaleKey,
    readonly problem?: string | null,
    readonly fallbackKey?: LocaleKey,
  ) {
    super(key);
  }
}

export function panelErrorText(error: Error | string | null): string | null {
  if (error instanceof LocalizedPanelError) {
    return t(error.key, error.fallbackKey ? { problem: error.problem ?? t(error.fallbackKey) } : undefined);
  }
  if (error == null) return null;
  return readableError(error);
}
