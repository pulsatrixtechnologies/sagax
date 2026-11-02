import { useCallback, useEffect, useState } from "react";
import type { UnattendedHostRow } from "../../../shared/remote-unattended-host";
import {
  attachBotRemoteHost,
  detachBotRemoteHost,
  fetchBotRemoteHosts,
  openBotRemoteHost,
} from "../remote-session/bot-remote-hosts-client";
import { useRemoteSessions } from "../remote-session/use-remote-sessions";

export function useRemoteHosts(botId: string, bridgeStatus: unknown) {
  const { rows: remoteSessionRows, reload: reloadRemoteSessions } = useRemoteSessions(bridgeStatus ? botId : undefined);
  // Connected sessions feed the place screen for attached hosts.
  const activeRemoteSessions = remoteSessionRows.filter((row) => row.state === "connected");
  const [attachedHosts, setAttachedHosts] = useState<UnattendedHostRow[]>([]);
  const [catalogHosts, setCatalogHosts] = useState<UnattendedHostRow[]>([]);
  const reloadRemoteHosts = useCallback(() => {
    if (!bridgeStatus) return;
    fetchBotRemoteHosts(botId)
      .then((body) => {
        setAttachedHosts(body.hosts);
        setCatalogHosts(body.catalog);
      })
      .catch(() => {});
  }, [bridgeStatus, botId]);
  useEffect(() => { reloadRemoteHosts(); }, [reloadRemoteHosts]);

  const onPickRemoteHost = useCallback((hostId: string) => {
    void openBotRemoteHost(botId, hostId).then((out) => {
      if (out.ok) reloadRemoteSessions();
    });
  }, [botId, reloadRemoteSessions]);

  const onAttachRemoteHost = useCallback(async (hostId: string) => {
    const out = await attachBotRemoteHost(botId, hostId);
    if (!out.ok) return false;
    reloadRemoteHosts();
    const opened = await openBotRemoteHost(botId, hostId);
    if (opened.ok) reloadRemoteSessions();
    return true;
  }, [botId, reloadRemoteHosts, reloadRemoteSessions]);

  const onDetachRemoteHost = useCallback(async (hostId: string) => {
    const out = await detachBotRemoteHost(botId, hostId);
    if (out.ok) reloadRemoteHosts();
    return out.ok;
  }, [botId, reloadRemoteHosts]);

  return {
    activeRemoteSessions,
    remoteHostRows: attachedHosts,
    catalogHosts,
    reloadRemoteHosts,
    reloadRemoteSessions,
    onPickRemoteHost,
    onAttachRemoteHost,
    onDetachRemoteHost,
  };
}
