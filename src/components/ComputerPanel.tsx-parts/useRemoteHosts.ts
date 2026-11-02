import { useCallback, useEffect, useState } from "react";
import type { UnattendedHostRow } from "../../../shared/remote-unattended-host";
import { openBotRemoteHost, fetchBotRemoteHosts } from "../remote-session/bot-remote-hosts-client";
import { useRemoteSessions } from "../remote-session/use-remote-sessions";

export function useRemoteHosts(botId: string, bridgeStatus: unknown) {
  const { rows: remoteSessionRows, reload: reloadRemoteSessions } = useRemoteSessions(bridgeStatus ? botId : undefined);
  // Only connected sessions: ended or temporary ones never linger as active.
  const activeRemoteSessions = remoteSessionRows.filter((row) => row.state === "connected");
  const [remoteHostRows, setRemoteHostRows] = useState<UnattendedHostRow[]>([]);
  const reloadRemoteHosts = useCallback(() => {
    if (!bridgeStatus) return;
    fetchBotRemoteHosts(botId)
      .then((body) => setRemoteHostRows(body.hosts))
      .catch(() => {});
  }, [bridgeStatus, botId]);
  useEffect(() => { reloadRemoteHosts(); }, [reloadRemoteHosts]);
  const onPickRemoteHost = useCallback((hostId: string) => {
    void openBotRemoteHost(botId, hostId).then((out) => {
      if (out.ok) reloadRemoteSessions();
    });
  }, [botId, reloadRemoteSessions]);
  return {
    activeRemoteSessions,
    remoteHostRows,
    reloadRemoteHosts,
    reloadRemoteSessions,
    onPickRemoteHost,
  };
}
