// Owner switch: plugin lifecycle hooks run on the bot's computer, never
// on the Sagax server. Off until the owner turns it on.
import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { DescribedRow, Switch } from "../SettingsPrimitives";

export function LifecycleHooksRow({ botId }: { botId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setReady(false);
    void api<{ enabled: boolean; events: string[] }>(`/api/bots/${encodeURIComponent(botId)}/lifecycle-hooks`)
      .then((body) => {
        if (!alive) return;
        setEnabled(body.enabled);
        setEvents(body.events);
        setReady(true);
      })
      .catch(() => { if (alive) setReady(false); });
    return () => { alive = false; };
  }, [botId]);

  if (!ready) return null;

  const toggle = () => {
    const next = !enabled;
    setError(null);
    setEnabled(next);
    void api(`/api/bots/${encodeURIComponent(botId)}/lifecycle-hooks`, {
      method: "PUT",
      body: JSON.stringify({ enabled: next }),
    }).catch((cause: unknown) => {
      setEnabled(!next);
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  return (
    <DescribedRow
      label={t("botPanel.hooks.title")}
      description={events.length ? events.join(", ") : t("botPanel.hooks.empty")}
      help={t("botPanel.hooks.help")}
      rowId="lifecycleHooks"
    >
      <Switch checked={enabled} aria-label={t("botPanel.hooks.title")} onClick={toggle} />
      {error && <span role="alert" className="sr-only">{error}</span>}
    </DescribedRow>
  );
}
