// Access: the cloud backend for a solo bot, its working folder, connected
// apps and browser toggles, its webhooks, and the standing "always allowed"
// grants. Works on lives once, at the top of the Computer tab
// (src/components/computer/WorksOnSetting.tsx). Cloud backend and auto-start
// VPS, Working folder, Connected apps, and Browser are moved verbatim from
// SettingsPanel.tsx; the connected-service list, webhooks list, and
// always-allowed list (the first read-only view of standing grants) are new.
import { useState } from "react";
import { boatComputerEnabled, vpsComputerEnabled } from "@/lib/feature-flags";
import { ArrowUpRight, FolderOpen, Globe, Power } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { DeveloperLink } from "../settings/DeveloperLink";
import { useBotEditor } from "./BotEditorContext";
import { cn } from "@/lib/cn";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { t } from "@/lib/i18n";
import { readableOr } from "../../../shared/human-id";
import { readableName } from "../../../shared/readable-name";
import { mcpAccountFor, mcpServersForBot, useMcpServers, withMcpAccount } from "@/lib/mcp-servers";
import { cloudComputersOffered } from "@/lib/place";
import { shortPath } from "@/lib/short-path";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { BrowserUnavailableNote, SettingsText } from "../SettingsLink";
import { CloudBackendPicker } from "../CloudBackendPicker";
import { RemoteFolderField } from "../remote-session/RemoteFolderField";
import { PILL, PLAIN_FIELD, PillSelect, Switch, useSettingsSurface } from "../SettingsPrimitives";
import { ProposalStatus } from "./ProposalStatus";
import { toolLabel } from "./ToolSelectionCard";
import { inputCls } from "./field";
import { PaneEmpty, PaneSection, usePaneRows } from "./PaneSection";
import { BackgroundBriefCard } from "./BackgroundBriefCard";
import type { useBotSettingsDerived } from "./useBotSettingsDerived";
import { readableError } from "@/lib/plain-error";

/** Where a bot's shell tools run. Set per bot; each task pins its own copy
 * on its first turn (the server does the pinning: Claude keeps sessions
 * per project folder, so a folder must not move under a live task). The
 * PATCH is made directly rather than through updateBot: the server
 * validates the path and a rejected folder must not stick in local state. */
export function WorkingFolder({ bot }: { bot: Bot }) {
  const { request: api } = useBotEditor();
  const solo = usePerspicaxOrg() === null;
  const { capabilities } = useDesktopCapabilities();
  const home = capabilities.host.homeDir;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canPick = Boolean(window.ogb?.pickFolder);
  const plain = useSettingsSurface() === "plain";
  // #2092: the field shows the folder in use, the server's default when
  // the bot has none of its own (/workspace/bots/<slug>)
  const shown = bot.cwd ?? bot.workFolder ?? "";

  const save = async (cwd: string | null) => {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ cwd }) });
      setDraft(null);
    } catch (e) {
      setError(readableError(e));
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
            // an emptied field, or the default itself, clears the folder: the server wants null
            const next = (draft ?? shown).trim();
            void save(next && !(next === bot.workFolder && !bot.cwd) ? next : null);
          }}
        >
          <RemoteFolderField
            botId={bot.id}
            solo={solo}
            plainWithoutComputer
            inputClassName={cn(plain ? PLAIN_FIELD : inputCls, "font-mono text-[12.5px]")}
            placeholder={t("botPanel.access.placeholder")}
            value={draft ?? shown}
            onChange={setDraft}
          />
          {draft !== null ? (
            <button type="submit" disabled={saving} className={cn(PILL, "shrink-0")}>
              {t("common.save")}
            </button>
          ) : bot.cwd && bot.workFolder ? (
            <button type="button" onClick={() => void save(null)} disabled={saving} className={cn(PILL, "shrink-0")}>
              {t("botPanel.access.clear")}
            </button>
          ) : null}
        </form>
      )}
      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
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
  const plain = useSettingsSurface() === "plain";
  return (
    <button
      type="button"
      data-manage-in-connect-apps={surface}
      onClick={() => {
        dispatch({ type: "toggleSettings", open: false });
        dispatch({ type: "togglePlugins", open: true, surface });
      }}
      className={plain ? cn(PILL, "shrink-0 gap-1") : "flex items-center gap-1 rounded-lg px-1 py-1.5 text-[12.5px] font-medium text-accent-text hover:underline"}
    >
      {t("botPanel.skills.manageInConnectApps")} <ArrowUpRight size={13} aria-hidden="true" />
    </button>
  );
}

/** An Always allow key in words ("mcp:mail:read_notes" reads "Mail · Read
 * notes"); anything else (a command) stays as written. */
function alwaysLabel(entry: string): string | null {
  const mcp = /^mcp:([^:]+):(.+)$/.exec(entry);
  if (mcp) return `${readableName(mcp[1])} · ${toolLabel(mcp[2])}`;
  const native = /^native:(.+)$/.exec(entry);
  return native ? toolLabel(native[1]) : null;
}

function McpServersCard({ bot, patch }: {
  bot: Bot;
  patch: (patch: { mcpServers: string[] | null } | { mcpAccounts: Record<string, string> | null }) => void;
}) {
  const { servers, error, refresh } = useMcpServers();
  const mounted = new Set((servers ? mcpServersForBot(servers, bot.mcpServers) : []).map((server) => server.name));
  const usesAll = bot.mcpServers == null;
  const rows = usePaneRows();
  const { plain } = rows;

  const toggle = (name: string) => {
    if (!servers || bot.busy || error) return;
    const current = usesAll ? servers.filter((server) => server.enabled).map((server) => server.name) : [...(bot.mcpServers ?? [])];
    const next = current.includes(name) ? current.filter((item) => item !== name) : [...current, name];
    patch({ mcpServers: next });
  };
  return (
    <PaneSection
      title={<>{t("connectors.tab.mcp")}<ProposalStatus bot={bot} /></>}
      help={t("botAccess.mcpDescription")}
      // the profile page: the one way to Plugins is the card's action pill
      action={plain ? <ManageInConnectApps surface="mcp" /> : undefined}
    >
      {error && (
        <div role="alert" className={plain ? "flex flex-wrap items-center gap-2 pb-2 text-[12px] leading-4 text-danger" : "mt-3 text-[12px] text-danger"}>
          {t("botAccess.mcpRefreshError")} <button type="button" onClick={() => void refresh()} className={plain ? PILL : "underline"}>{t("connectors.action.retry")}</button>
        </div>
      )}
      {servers === null ? !error && (
        <PaneEmpty>{t("mcp.loading")}</PaneEmpty>
      ) : servers.length === 0 ? (
        <PaneEmpty>{t("botAccess.mcpEmpty")}</PaneEmpty>
      ) : (
        <div className={cn(rows.bleed, "-mt-1", rows.list)}>
          {servers.map((server) => (
            <div key={server.name} className={cn("flex min-h-[44px] items-center justify-between gap-3 py-2", rows.row)}>
              <div className="min-w-0 flex-1">
                <div title={server.name} className={cn("truncate text-ink", rows.title)}>{readableName(server.name)}</div>
                {!server.enabled && <div className={cn("text-ink-secondary", rows.note)}>{t("botAccess.mcpDisabled")}</div>}
              </div>
              {server.accounts && mounted.has(server.name) && (
                <span data-mcp-account={server.name} className="inline-flex min-w-0 max-w-[45%]">
                  <PillSelect
                    value={mcpAccountFor(server, bot.mcpAccounts)}
                    disabled={!!error}
                    onChange={(account) => patch({ mcpAccounts: withMcpAccount(bot.mcpAccounts, server.name, account) })}
                    ariaLabel={t("botAccess.mcpAccountAria", { name: readableName(server.name) })}
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
                aria-label={t("botAccess.mcpAllow", { name: readableName(server.name) })}
                onClick={() => toggle(server.name)}
                className="disabled:cursor-not-allowed"
              />
            </div>
          ))}
        </div>
      )}
      {(!plain || (!usesAll && servers && servers.length > 0)) && (
        <div className="mt-3 flex items-center gap-2">
          {!plain && <ManageInConnectApps surface="mcp" />}
          {!usesAll && servers && servers.length > 0 && (
            <button type="button" disabled={!!bot.busy || error} onClick={() => { if (!bot.busy && !error) patch({ mcpServers: null }); }} className={cn(PILL, "ml-auto")}>
              {t("botAccess.mcpUseAll")}
            </button>
          )}
        </div>
      )}
      {bot.busy && <p className="mt-2 text-[12px] leading-4 text-ink-secondary">{t("botAccess.mcpBusy")}</p>}
    </PaneSection>
  );
}

/** The tools the bot may use without asking (#2658: on Settings > Developer
 * and in the editor dialogs' fold). */
export function AlwaysAllowedCard({ bot, patch }: { bot: Bot; patch: (p: { alwaysAllow: string[] }) => void }) {
  const rows = usePaneRows();
  const alwaysAllow = bot.alwaysAllow ?? [];
  return (
    <PaneSection data-bot-always-allowed="" title={<>{t("botPanel.access.always")}<ProposalStatus bot={bot} /></>} help={t("botPanel.access.alwaysHelp")}>
      {alwaysAllow.length === 0 ? (
        <PaneEmpty>{t("botPanel.access.nothing")}</PaneEmpty>
      ) : (
        <div className={cn(rows.bleed, "-my-1", rows.list)}>
          {alwaysAllow.map((entry) => (
            <div key={entry} className={cn("flex min-h-[44px] items-center justify-between gap-3 py-2", rows.row)}>
              <span title={entry} className={cn("min-w-0 flex-1 truncate text-ink", alwaysLabel(entry) ? rows.title : "font-mono text-[12.5px]")}>{alwaysLabel(entry) ?? entry}</span>
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
    </PaneSection>
  );
}

export function AccessSection({
  bot,
  derived,
  part = "all",
}: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  /** One card alone (the bot creation wizard's Tools step, 2026-10-26).
   * The bot page's V6 sub-pages (#2612): "brief" (the background brief,
   * When it acts alone) and "advanced" (the worksite and the browser). The
   * working folder, tools, webhooks and always-allowed list are on
   * Settings > Developer since #2658; the editor dialogs (part "all") keep
   * them folded. */
  part?: "all" | "mcp" | "browser" | "brief" | "advanced";
}) {
  const { draft, bulk, mixedFields } = useBotEditor();
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
  const browserMixed = Boolean(bulk && mixedFields?.has("browser"));
  const { plain } = usePaneRows();

  // Where the bot runs, what it may reach, and which tools it may use are
  // not member fields. Hide the whole section when none of them can be saved.
  const canEdit = derived.canEdit ?? (() => true);
  if (!canEdit("computer") && !canEdit("cwd") && !canEdit("mcpServers") && !canEdit("browser")) return null;

  return (
    <div className="flex flex-col gap-5">
      {/* Boat or VPS is which cloud computer Auto and Cloud use. It is not
          a second Works on: that control is More > Computer. */}
      {(part === "all" || part === "advanced") && !organization && (!bot.computer || bot.computer === "cloud") && cloudComputersOffered(state.config) && (
        // the profile page: the card carries its own grey label, the note is
        // text and the start switch is a row, nothing boxed inside the card
        <PaneSection data-cloud-backend="" title={plain ? t("botPanel.cloud.backend") : undefined}>
          {!bot.computer && (plain ? (
            <p className="pb-3 text-[12px] leading-4 text-ink-secondary">
              <span className="text-ink">{t("worksOn.autoCloudTitle")}</span>{" "}
              {t("worksOn.autoCloudBody")}
            </p>
          ) : (
            <div className="rounded-lg bg-inset px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-secondary">
              <span className="font-medium text-ink">{t("worksOn.autoCloudTitle")}</span>{" "}
              {t("worksOn.autoCloudBody")}
            </div>
          ))}
          <CloudBackendPicker
            value={bot.cloudBackend ?? "box"}
            vpsSupported={canUseVps}
            organization={organization}
            boat={boatComputerEnabled(state.config)}
            vps={vpsComputerEnabled(state.config)}
            onChange={(backend) => patch({ cloudBackend: backend })}
          />
          {!bot.computer && bot.cloudBackend === "vps" && (
            <div className={plain ? "mt-3 flex min-h-[44px] items-center justify-between gap-4" : "mt-3 flex items-center justify-between gap-4 rounded-lg bg-inset px-3 py-2.5"}>
              <div className="flex min-w-0 items-start gap-3">
                {plain && <Power aria-hidden="true" className="mt-px size-5 shrink-0 text-ink-secondary" />}
                <div className="min-w-0">
                  <div className={cn("text-ink", plain ? "text-[14px] leading-5" : "text-[13px]")}>{t("botPanel.access.startVps")}</div>
                  <div className={cn("mt-0.5 text-ink-secondary", plain ? "text-[12px] leading-4" : "text-[11.5px]")}>
                    {t("botPanel.access.startVpsHelp")}
                  </div>
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

      {(part === "all" || part === "mcp") && <McpServersCard bot={bot} patch={patch} />}
      {(part === "all" || part === "brief") && !draft && <BackgroundBriefCard botId={bot.id} />}

      {(part === "all" || part === "browser" || part === "advanced") && browserFeature && <PaneSection title={<>{t("botPanel.access.browser")}<ProposalStatus bot={bot} /></>}>
        <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {plain && <Globe aria-hidden="true" className="mt-px size-5 shrink-0 text-ink-secondary" />}
          <div className={plain ? "text-[13px] leading-5 text-ink-secondary" : "text-[13px] text-ink-secondary"}>
            {!desktopBrowser
              ? browserBlockedOnWindows && !browserInstallable
                ? t("settings.experimental.browserWindows")
                : <BrowserUnavailableNote config={state.config} />
              : !browserFeature
                ? <SettingsText text={t("botAccess.browserSwitchedOff")} links={{ settings: { section: "computer", cardId: "computer.browser" } }} />
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
          mixed={browserMixed}
          aria-label={t("botPanel.access.browserGive")}
          disabled={
            bot.computer === "off" ||
            (!browserMixed && !browserEnabled && ((!desktopBrowser && !browserInstallable) || !browserFeature || !canUseBrowser))
          }
          onClick={() => patch({ browser: browserMixed ? true : !browserAllowed })}
          title={bot.computer === "off" ? t("botPanel.access.browserOffShort") : undefined}
          className="disabled:cursor-not-allowed"
        />
        </div>
      </PaneSection>}

      {/* The working folder, the tool list, webhooks and the commands always
          allowed live on Settings > Developer > Per bot (#2636, #2658): one
          option, one place. This page keeps one discreet link. */}
      {part === "all" && <DeveloperLink bot={draft ? undefined : bot} />}
    </div>
  );
}
