// Use Messages, on the Mac where this Sagax app runs. Hidden when the
// server is not that Mac (an organization server answers 404).
import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { SwitchRow } from "./SettingsPrimitives";

export function MessagesSettings() {
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
      setError(cause instanceof Error ? cause.message : String(cause));
    });
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
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </section>
  );
}
