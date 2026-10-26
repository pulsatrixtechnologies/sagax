// Access: the cloud backend for a solo bot, its working folder, connected
// apps and browser toggles, its webhooks, and the standing "always allowed"
// grants. Works on lives once, at the top of the Computer tab
// (src/components/computer/WorksOnSetting.tsx). Cloud backend and auto-start
// VPS, Working folder, Connected apps, and Browser are moved verbatim from
// SettingsPanel.tsx; the connected-service list, webhooks list, and
// always-allowed list (the first read-only view of standing grants) are new.
import { useState } from "react";
import { boatComputerEnabled, vpsComputerEnabled } from "@/lib/feature-flags";
import { ArrowUpRight, FolderOpen } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { AdvancedFold } from "./AdvancedFold";
import { useBotEditor } from "./BotEditorContext";
import { cn } from "@/lib/cn";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { t } from "@/lib/i18n";
import { readableOr } from "../../../shared/human-id";
import { mcpAccountFor, mcpServersForBot, useMcpServers, withMcpAccount } from "@/lib/mcp-servers";
import { cloudComputersOffered } from "@/lib/place";
import { shortPath } from "@/lib/short-path";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { BrowserUnavailableNote, SettingsText } from "../SettingsLink";
import { CloudBackendPicker } from "../CloudBackendPicker";
import { RemoteFolderField } from "../remote-session/RemoteFolderField";
import { PILL, PillSelect, Switch } from "../SettingsPrimitives";
import { ProposalStatus } from "./ProposalStatus";
import { ToolSelectionCard } from "./ToolSelectionCard";
import { inputCls } from "./field";
import { PaneEmpty, PaneSection } from "./PaneSection";
import { BotWebhooks } from "./BotWebhooks";
import type { useBotSettingsDerived } from "./useBotSettingsDerived";

/** Where a bot's shell tools run. Set per bot; each task pins its own copy
 * on its first turn (the server does the pinning: Claude keeps sessions
 * per project folder, so a folder must not move under a live task). The
 * PATCH is made directly rather than through updateBot: the server
 * validates the path and a rejected folder must not stick in local state. */
function WorkingFolder({ bot }: { bot: Bot }) {
  const { request: api } = useBotEditor();
  const { capabilities } = useDesktopCapabilities();
  const home = capabilities.host.homeDir;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canPick = Boolean(window.ogb?.pickFolder);
  const task = bot.tasks?.find((t) => t.threadId === bot.threadId);
  const pinned = task?.cwd; // undefined = not yet, null = legacy home, string = folder
  const pinnedElsewhere = pinned !== undefined && (pinned ?? undefined) !== bot.cwd;

  const save = async (cwd: string | null) => {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ cwd }) });
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const pick = async () => {
    const chosen = await window.ogb?.pickFolder?.(bot.cwd);
    if (chosen) void save(chosen);
  };

  return (
    <PaneSection title={t("botPanel.access.folder")} help={t("botPanel.access.folderHelp")}>
      {canPick ? (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink" title={bot.cwd}>
            {bot.cwd ? shortPath(bot.cwd, home) : <span className="text-ink-secondary">{t("botPanel.access.private")}</span>}
          </div>
          <button type="button" onClick={() => void pick()} disabled={saving} className={cn(PILL, "shrink-0 gap-1.5")}>
            <FolderOpen size={13} aria-hidden="true" /> {t("botPanel.access.choose")}
          </button>
          {bot.cwd && (
            <button type="button" onClick={() => void save(null)} disabled={saving} className={cn(PILL, "shrink-0")}>
              {t("botPanel.access.clear")}
            </button>
          )}
        </div>
      ) : (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            // an emptied field clears the folder: the server wants null
            void save((draft ?? bot.cwd ?? "").trim() || null);
          }}
        >
          <RemoteFolderField
            botId={bot.id}
            inputClassName={cn(inputCls, "font-mono text-[12.5px]")}
            placeholder={t("botPanel.access.placeholder")}
            value={draft ?? bot.cwd ?? ""}
            onChange={setDraft}
          />
          <button type="submit" disabled={saving || draft === null} className={cn(PILL, "shrink-0")}>
            {t("common.save")}
          </button>
        </form>
      )}
      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
      {pinnedElsewhere && (
        <div className="mt-2 text-[12px] text-ink-secondary">
          {t("botPanel.access.pinnedBefore")} {pinned ? <span className="font-mono">{shortPath(pinned, home)}</span> : t("botPanel.access.home")}. {t("botPanel.access.pinnedAfter")}
        </div>
      )}
    </PaneSection>
  );
}

/** Which app-wide MCP servers this bot mounts. Absent list = all enabled
 * (the pre-existing behavior); the first switch flip writes an explicit
 * list so later additions in Plugins do not silently reach this bot. */
/** Servers and apps are added, removed and set up in Connect apps only;
 * here a bot only picks among them. This link opens the panel there. */
function ManageInConnectApps({ surface }: { surface: "apps" | "mcp" }) {
  const { dispatch } = useStore();
  return (
    <button
      type="button"
      data-manage-in-connect-apps={surface}
      onClick={() => {
        dispatch({ type: "toggleSettings", open: false });
        dispatch({ type: "togglePlugins", open: true, surface });
      }}
      className="flex items-center gap-1 rounded-lg px-1 py-1.5 text-[12.5px] font-medium text-accent-text hover:underline"
    >
      {t("botAccess.manageInConnectApps")} <ArrowUpRight size={13} aria-hidden="true" />
    </button>
  );
}

function McpServersCard({ bot, patch }: {
  bot: Bot;
  patch: (patch: { mcpServers: string[] | null } | { mcpAccounts: Record<string, string> | null }) => void;
}) {
  const { servers, error, refresh } = useMcpServers();
  const mounted = new Set((servers ? mcpServersForBot(servers, bot.mcpServers) : []).map((server) => server.name));
  const usesAll = bot.mcpServers == null;

  const toggle = (name: string) => {
    if (!servers || bot.busy || error) return;
    const current = usesAll ? servers.filter((server) => server.enabled).map((server) => server.name) : [...(bot.mcpServers ?? [])];
    const next = current.includes(name) ? current.filter((item) => item !== name) : [...current, name];
    patch({ mcpServers: next });
  };
  return (
    <PaneSection title={<>{t("connectors.tab.mcp")}<ProposalStatus bot={bot} /></>} help={t("botAccess.mcpDescription")}>
      {error && (
        <div role="alert" className="mt-3 text-[12px] text-danger">
          {t("botAccess.mcpRefreshError")} <button type="button" onClick={() => void refresh()} className="underline">{t("connectors.action.retry")}</button>
        </div>
      )}
      {servers === null ? !error && (
        <PaneEmpty>{t("mcp.loading")}</PaneEmpty>
      ) : servers.length === 0 ? (
        <PaneEmpty>{t("botAccess.mcpEmpty")}</PaneEmpty>
      ) : (
        <div className="-mx-3.5 -mt-1 divide-y divide-hairline/40">
          {servers.map((server) => (
            <div key={server.name} className="flex min-h-[44px] items-center justify-between gap-3 px-3.5 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[12.5px] text-ink">{server.name}</div>
                {!server.enabled && <div className="text-[11.5px] text-ink-secondary">{t("botAccess.mcpDisabled")}</div>}
              </div>
              {server.accounts && mounted.has(server.name) && (
                <span data-mcp-account={server.name} className="inline-flex min-w-0 max-w-[45%]">
                  <PillSelect
                    value={mcpAccountFor(server, bot.mcpAccounts)}
                    disabled={!!error}
                    onChange={(account) => patch({ mcpAccounts: withMcpAccount(bot.mcpAccounts, server.name, account) })}
                    ariaLabel={t("botAccess.mcpAccountAria", { name: server.name })}
                    options={server.accounts.map((account, index) => ({
                      value: account.id,
                      label: (account.id === "default" ? t("botAccess.mcpAccountFirst") : readableOr(account.label ?? account.id, t("ids.accountN", { n: index + 1 })))
                        + (account.connected ? "" : ` (${t("mcp.accounts.notSignedIn")})`),
                    }))}
                  />
                </span>
              )}
              <Switch
                checked={mounted.has(server.name)}
                disabled={!server.enabled || !!bot.busy || error}
                aria-label={t("botAccess.mcpAllow", { name: server.name })}
                onClick={() => toggle(server.name)}
                className="disabled:cursor-not-allowed"
              />
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <ManageInConnectApps surface="mcp" />
        {!usesAll && servers && servers.length > 0 && (
          <button type="button" disabled={!!bot.busy || error} onClick={() => { if (!bot.busy && !error) patch({ mcpServers: null }); }} className={cn(PILL, "ml-auto")}>
            {t("botAccess.mcpUseAll")}
          </button>
        )}
      </div>
      {bot.busy && <p className="mt-2 text-[12px] text-ink-secondary">{t("botAccess.mcpBusy")}</p>}
    </PaneSection>
  );
}

export function AccessSection({
  bot,
  derived,
}: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
}) {
  const { draft } = useBotEditor();
  const { state } = useStore();
  // Organization server: bots work in their owner's server environment.
  const organization = usePerspicaxOrg() !== null;
  const {
    patch,
    canUseVps,
    canUseBrowser,
    desktopBrowser,
    browserBlockedOnWindows,
    browserFeature,
    browserAllowed,
    browserEnabled,
  } = derived;
  const browserInstallable = state.config?.browserEngine?.installable === true;

  const alwaysAllow = bot.alwaysAllow ?? [];

  // Where the bot runs, what it may reach, and which tools it may use are
  // not member fields. Hide the whole section when none of them can be saved.
  const canEdit = derived.canEdit ?? (() => true);
  if (!canEdit("computer") && !canEdit("cwd") && !canEdit("mcpServers") && !canEdit("browser")) return null;

  return (
    <div className="flex flex-col gap-5">
      {/* Boat or VPS is which cloud computer Auto and Cloud use. It is not
          a second Works on: that control is More > Computer. */}
      {!organization && (!bot.computer || bot.computer === "cloud") && cloudComputersOffered(state.config) && (
        <PaneSection data-cloud-backend="">
          {!bot.computer && (
            <div className="rounded-lg bg-inset px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-secondary">
              <span className="font-medium text-ink">{t("worksOn.autoCloudTitle")}</span>{" "}
              {t("worksOn.autoCloudBody")}
            </div>
          )}
          <CloudBackendPicker
            value={bot.cloudBackend ?? "box"}
            vpsSupported={canUseVps}
            organization={organization}
            boat={boatComputerEnabled(state.config)}
            vps={vpsComputerEnabled(state.config)}
            onChange={(backend) => patch({ cloudBackend: backend })}
          />
          {!bot.computer && bot.cloudBackend === "vps" && (
            <div className="mt-3 flex items-center justify-between gap-4 rounded-lg bg-inset px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[13px] text-ink">{t("botPanel.access.startVps")}</div>
                <div className="mt-0.5 text-[11.5px] text-ink-secondary">
                  {t("botPanel.access.startVpsHelp")}
                </div>
              </div>
              <Switch
                checked={Boolean(bot.autoStartVps)}
                aria-label={t("botPanel.access.startVps")}
                onClick={() => patch({ autoStartVps: !bot.autoStartVps })}
              />
            </div>
          )}
        </PaneSection>
      )}

      <McpServersCard bot={bot} patch={patch} />

      {browserFeature && <PaneSection title={<>{t("botPanel.access.browser")}<ProposalStatus bot={bot} /></>}>
        <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[13px] text-ink-secondary">
            {!desktopBrowser
              ? browserBlockedOnWindows && !browserInstallable
                ? t("settings.experimental.browserWindows")
                : <BrowserUnavailableNote config={state.config} />
              : !browserFeature
                ? <SettingsText text={t("botAccess.browserSwitchedOff")} links={{ settings: { section: "experimental", cardId: "experimental.features" } }} />
                : !canUseBrowser
                  ? t("botPanel.access.browserModel")
                  : bot.computer === "off"
                    ? t("botPanel.access.browserOff")
                    : browserEnabled
                      ? t("botPanel.access.browserOn")
                      : t("botPanel.access.browserKeepOff")}
          </div>
        </div>
        <Switch
          checked={browserEnabled && bot.computer !== "off"}
          aria-label={t("botPanel.access.browserGive")}
          disabled={
            bot.computer === "off" ||
            (!browserEnabled && ((!desktopBrowser && !browserInstallable) || !browserFeature || !canUseBrowser))
          }
          onClick={() => patch({ browser: !browserAllowed })}
          title={bot.computer === "off" ? t("botPanel.access.browserOffShort") : undefined}
          className="disabled:cursor-not-allowed"
        />
        </div>
      </PaneSection>}

      {/* The working folder, the tool list, webhooks and the commands
          always allowed: folded, one click away. */}
      <AdvancedFold id="access">
        <WorkingFolder bot={bot} />
        <ToolSelectionCard key={bot.id} bot={bot} engineKind={derived.engine?.driverKind} />
        {!draft && <BotWebhooks bot={bot} />}
        {!draft && <PaneSection title={<>{t("botPanel.access.always")}<ProposalStatus bot={bot} /></>} help={t("botPanel.access.alwaysHelp")}>
          {alwaysAllow.length === 0 ? (
            <PaneEmpty>{t("botPanel.access.nothing")}</PaneEmpty>
          ) : (
            <div className="-mx-3.5 -my-1 divide-y divide-hairline/40">
              {alwaysAllow.map((entry) => (
                <div key={entry} className="flex min-h-[44px] items-center justify-between gap-3 px-3.5 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">{entry}</span>
                  <button
                    type="button"
                    aria-label={t("botPanel.access.removeAlways", { entry })}
                    onClick={() => patch({ alwaysAllow: alwaysAllow.filter((key) => key !== entry) })}
                    className={cn(PILL, "shrink-0")}
                  >
                    {t("botPanel.access.remove")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </PaneSection>}
      </AdvancedFold>
    </div>
  );
}
