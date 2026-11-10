import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { savedKeysUnreadable } from "@/lib/saved-keys-reset";
import { PILL, SettingsNotice } from "./SettingsPrimitives";

/** The desktop's open reset, shared by every button so a remounted one cannot send a second. */
let resetting: Promise<string | null> | null = null;

/** Whether this app's desktop could not read its saved keys this launch (asked once per mount). */
export function useSavedKeysUnreadable(): boolean {
  const [unreadable, setUnreadable] = useState(false);
  useEffect(() => {
    let live = true;
    void savedKeysUnreadable().then((answer) => { if (live) setUnreadable(answer); });
    return () => { live = false; };
  }, []);
  return unreadable;
}

/** "Reset saved keys": the desktop moves the unreadable file aside (kept, never deleted) and restarts. The click is the
 * decision, so no second question. A failure to move the file shows next to the button. Renders nothing unless this
 * app's desktop could not read its saved keys this launch. */
export function SavedKeysResetButton() {
  const unreadable = useSavedKeysUnreadable();
  const [pending, setPending] = useState(() => resetting !== null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    // The notice this button sits in can be swapped for another while a reset runs: the new button waits too.
    void resetting?.then((error) => { if (live) { setPending(false); setFailure(error); } });
    return () => { live = false; };
  }, []);
  if (!unreadable) return null;
  const reset = () => {
    if (resetting) return;
    setPending(true);
    setFailure(null);
    const request = Promise.resolve(window.ogb?.credentialStore?.reset())
      .then((answer) => (answer?.status === "failed" ? t("savedKeys.resetFailed", { error: answer.error ?? "" }) : null))
      .catch((error: unknown) => t("savedKeys.resetFailed", { error: readableError(error) }));
    resetting = request;
    void request.then((error) => {
      resetting = null;
      setPending(false);
      setFailure(error);
    });
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-saved-keys-reset="">
      {failure && <span role="alert" className="text-[12px] text-danger">{failure}</span>}
      <button type="button" className={PILL} onClick={reset} disabled={pending}>
        {t("savedKeys.reset")}
      </button>
    </span>
  );
}

/** Its own warning line with the reset, for a page with no other notice about the saved keys to sit in. `panel` draws it
 * like the Apps panel's other notices; otherwise it is a Settings notice. */
export function SavedKeysResetNotice({ panel = false }: { panel?: boolean }) {
  const unreadable = useSavedKeysUnreadable();
  if (!unreadable) return null;
  if (panel) {
    return (
      <div role="alert" className="mx-6 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warning/10 px-3 py-2 text-[12px] text-warning sm:mx-8" data-saved-keys-notice="">
        <span className="min-w-0 flex-1 basis-[240px]">{t("savedKeys.unreadable")}</span>
        <SavedKeysResetButton />
      </div>
    );
  }
  return (
    <div data-saved-keys-notice="">
      <SettingsNotice tone="warning" action={<SavedKeysResetButton />}>{t("savedKeys.unreadable")}</SettingsNotice>
    </div>
  );
}
