// How the organization's bots work (0.5.6, Decision: the reference design's rows): routines in
// the conversation, group turns and MCP calls, one row each, label and a
// short grey line at the left, the control at the right. They came from
// General > Advanced (2026-10-15) and set the installation, so they show to
// those who may edit it, in Advanced mode. A desktop with no server shows
// them in General > Advanced (Organization is hidden there): same rows, same
// card ids, so a deep link finds them on either page.
import { useState } from "react";

import { routinesInConversationEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import { canEditConfig } from "@/lib/viewer";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { McpCallTimeoutSettings } from "../McpCallTimeoutSettings";
import { RoomTurnTimeoutSettings } from "../RoomTurnTimeoutSettings";
import { DescribedRow, Switch } from "../SettingsPrimitives";

export function RoutinesInConversationRow() {
  const { state, dispatch } = useStore();
  const enabled = routinesInConversationEnabled(state.config);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features: { routinesInConversation: !enabled } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.routinesInConversation.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-settings-card="organization.routinesInConversation">
      <DescribedRow
        label={t("settings.routinesInConversation.title")}
        rowId="routinesInConversation"
        description={error ? <span role="alert" className="text-danger">{error}</span> : t("settings.routinesInConversation.short")}
      >
        <Switch
          checked={enabled}
          aria-label={t("settings.routinesInConversation.aria")}
          disabled={saving}
          onClick={() => void toggle()}
          className="disabled:cursor-wait disabled:opacity-50"
        />
      </DescribedRow>
    </div>
  );
}

/** The three rows, for a group's card. Nothing for a viewer who cannot edit
 * the installation. Routines in the conversation is the server's: a desktop
 * that is another computer's client does not show it, as before. */
export function OrganizationBotRows() {
  const { state } = useStore();
  const remoteActive = typeof window !== "undefined" && window.ogb?.remoteClient?.active === true;
  if (!canEditConfig(state.config)) return null;
  return (
    <>
      {!remoteActive && <RoutinesInConversationRow />}
      <RoomTurnTimeoutSettings />
      <McpCallTimeoutSettings />
    </>
  );
}
