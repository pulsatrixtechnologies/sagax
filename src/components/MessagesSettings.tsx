// Messages shortcut on Settings > Computer. The full setup lives under
// Connect apps > Mac > Messages (parity with Grok Bot's placement).
import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { api, useStore } from "@/state/store";
import { SwitchRow } from "./SettingsPrimitives";
import { readableError } from "@/lib/plain-error";

export function MessagesSettings() {
  const { dispatch } = useStore();
  const [useMessages, setUseMessages] = useState(false);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api<{ useMessages: boolean; available: boolean }>("/api/messages")
      .then((body) => {
        if (!alive || !body.available) return;
        setUseMessages(body.useMessages);
        setVisible(true);
      })
      .catch(() => { /* not this Mac */ });
    return () => { alive = false; };
  }, []);

  if (!visible) return null;

  const toggle = (next: boolean) => {
    setError(null);
    setUseMessages(next);
    void api("/api/messages", {
      method: "PUT",
      body: JSON.stringify({ useMessages: next }),
    }).catch((cause: unknown) => {
      setUseMessages(!next);
      setError(readableError(cause));
    });
  };

  const openSetup = () => {
    dispatch({ type: "togglePlugins", open: true, surface: "apps" });
    // The Mac > Messages page is pushed once Connect apps is up.
    window.dispatchEvent(new CustomEvent("sagax:open-mac-messages"));
  };

  return (
    <section className="mt-4 rounded-xl border border-hairline/40 px-4 py-3" data-testid="messages-settings">
      <SwitchRow
        label={t("settings.messages.use")}
        description={t("settings.messages.help")}
        help={t("settings.messages.permission")}
        checked={useMessages}
        onChange={toggle}
      />
      <button
        type="button"
        data-messages-open-setup
        onClick={openSetup}
        className="mt-2 text-[12.5px] font-medium text-accent-text hover:underline"
      >
        {t("settings.messages.openSetup")}
      </button>
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </section>
  );
}
