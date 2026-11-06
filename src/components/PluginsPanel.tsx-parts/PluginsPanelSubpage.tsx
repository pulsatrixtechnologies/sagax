import { useEffect, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { t } from "@/lib/i18n";
import { permissionMissingText } from "@/lib/permissions";
import { detailIdentity } from "@/lib/installed-model";
import { fetchBotTailscale } from "@/lib/bot-tailscale";
import type { SkillsLibrarySkillWire } from "../../../shared/wire";
import { TailscaleConnectView } from "../plugins/TailscaleConnectView";
import type { Crumb } from "../Breadcrumb";
import { connectAppsTabLabel, type ConnectAppsTab } from "../plugins/ConnectAppsView";
import { PluginPageHeader } from "../plugins/PluginParts";
import { PluginDetailView } from "../plugins/PluginDetailView";
import { SkillPage } from "../plugins/SkillPage";
import { BotsForView } from "../plugins/BotsForView";
import { MessagesSetupView } from "../plugins/MessagesSetupView";
import { CustomConnectorPage } from "../plugins/CustomConnectorPage";
import { detailProps } from "./detailBuilders";
import type { Page } from "./types";
import type { PluginsPanelState } from "./usePluginsPanelState";
import type { PluginsPanelActions } from "./usePluginsPanelActions";
import type { InstalledEntry } from "@/lib/installed-model";
import type { PluginItem } from "@/lib/plugins-model";

export function PluginsPanelSubpage({
  s,
  a,
  trail,
  entries,
  botsForEntry,
  botsForRows,
  toggleBotServers,
}: {
  s: PluginsPanelState;
  a: PluginsPanelActions;
  trail: Crumb[];
  entries: InstalledEntry[];
  botsForEntry: InstalledEntry | undefined;
  botsForRows: (entry: InstalledEntry) => Array<{ id: string; name: string; on: boolean }>;
  toggleBotServers: (entry: InstalledEntry, botId: string, on: boolean) => void;
}): ReactNode {
  const {
    page, skills, skillsRoute, scope, ownerOrAdmin, libraryEditor, perspicaxOrg, marketplaces,
    back, setStack, loadSkills, items, mcp, mcpAccountDraft, setMcpAccountDraft,
    shownMarketplaces, installing,
  } = s;
  const {
    githubSection, openGithub, githubKey, openItem, uninstallPlugin, updatePlugin, botCard,
    detailHead, engineInfo, setTailscaleView,
  } = a;

  const detailItem = page.page === "detail" ? items.find((item) => item.key === page.key) : undefined;
  // An item that went away (uninstalled, or removed elsewhere) leaves its page.
  const detailMissing = page.page === "detail" && !detailItem && mcp.servers !== null && skills !== null && shownMarketplaces !== null;
  // A skill deleted or renamed elsewhere leaves its page too.
  const skillMissing = page.page === "skill" && Boolean(page.name) && skills !== null && !skills.some((entry) => entry.name === page.name);
  // An entry removed while its "For which bots" is open leaves it too.
  const botsForMissing = page.page === "botsFor" && !botsForEntry && mcp.servers !== null && shownMarketplaces !== null;
  useEffect(() => {
    if (detailMissing || skillMissing || botsForMissing) back();
  }, [detailMissing, skillMissing, botsForMissing, back]);
  // The GitHub page opened before the marketplaces answered: the GitHub
  // plugin's page, once it is known.
  const githubLate = page.page === "github" && githubKey !== null;
  useEffect(() => {
    if (!githubLate || !githubKey) return;
    setStack((current) => current[current.length - 1]?.page === "github" ? [...current.slice(0, -1), { page: "detail", key: githubKey }] : current);
  }, [githubLate, githubKey, setStack]);

  const pageSkill = page.page === "skill" && page.name ? skills?.find((entry) => entry.name === page.name) : undefined;
  const skillReadOnly = (skill: SkillsLibrarySkillWire): string | undefined => {
    if (scope === "me") return undefined;
    if (ownerOrAdmin === false && !libraryEditor) return perspicaxOrg !== null ? permissionMissingText("skills.library") : t("connectApps.skill.readOnlyOwner");
    if (skill.version) return t("connectApps.skill.readOnlyOrganization");
    const plugin = marketplaces?.find((market) => market.name === skill.source)?.plugins.find((entry) => entry.installed && entry.skills.includes(skill.name));
    if (plugin) return t("connectApps.skill.readOnlyPlugin", { plugin: plugin.name });
    return undefined;
  };

  // A page opened from a tab (2026-10-28): inside that tab's panel, under
  // the title, scope and tabs. Browse Bots is the Bots tab, a pane of its
  // own (#2104).
  if (page.page === "skill" && (pageSkill || !page.name)) {
    return (
      <SkillPage
        key={`${scope}:${page.name ?? "new"}`}
        basePath={skillsRoute}
        skill={pageSkill}
        readOnlyReason={pageSkill ? skillReadOnly(pageSkill) : undefined}
        onBack={back}
        trail={trail}
        onSaved={async (name) => {
          await loadSkills();
          setStack((current) => current.map((entry, index) => index === current.length - 1 && entry.page === "skill" ? { ...entry, name } : entry));
        }}
        onDeleted={async () => {
          await loadSkills();
          setStack((current) => current[current.length - 1]?.page === "skill" && current.length > 1 ? current.slice(0, -1) : current);
        }}
      />
    );
  }
  if (page.page === "botsFor" && botsForEntry) {
    return (
      <BotsForView
        name={botsForEntry.name}
        bots={botsForRows(botsForEntry)}
        onToggle={(botId, on) => toggleBotServers(botsForEntry, botId, on)}
        onBack={back}
        trail={trail}
      />
    );
  }
  if (page.page === "github") {
    return (
      <>
        <PluginPageHeader title={t("myConnections.github.title")} trail={trail} onBack={back} />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-7 pt-3 sm:px-8" data-plugins-github-page>
          {githubSection ?? <p className="rounded-xl bg-inset px-4 py-3 text-[12.5px] text-ink-secondary">{t("connectApps.manage.accountsEmpty")}</p>}
        </div>
      </>
    );
  }
  if (page.page === "connector") {
    return <CustomConnectorPage mcp={mcp} onBack={back} trail={trail} />;
  }
  if (page.page === "mac-messages") {
    return <MessagesSetupView onBack={back} trail={trail} />;
  }
  if (page.page === "tailscale") {
    return (
      <TailscaleConnectView
        trail={trail}
        onBack={() => {
          back();
          void fetchBotTailscale().then(setTailscaleView).catch(() => undefined);
        }}
      />
    );
  }
  if (page.page === "detail" && detailItem) {
    const identity = detailIdentity(detailItem, entries);
    const base = detailProps(detailItem, {
      mcp, mcpAccountDraft, setMcpAccountDraft, openGithub, githubKey, githubSection,
      items, marketplaces: shownMarketplaces, installing, openItem,
      uninstallPlugin: (item) => void uninstallPlugin(item),
      updatePlugin: (item) => void updatePlugin(item),
      scope, botCard: botCard(detailItem),
    });
    const engines = engineInfo(detailItem);
    return (
      <PluginDetailView
        {...base}
        details={engines.row ? [...base.details, engines.row] : base.details}
        notice={engines.notice}
        {...detailHead(detailItem)}
        displayName={identity.name}
        icon={identity.icon}
        onBack={back}
        trail={trail}
      />
    );
  }
  if (page.page === "detail" || page.page === "skill" || page.page === "botsFor") {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-ink-secondary">
        <Loader2 size={14} className="animate-spin" /> {t("connectors.loadingCatalog")}
      </div>
    );
  }
  return null;
}

export function pageLabel(entry: Page, tab: ConnectAppsTab, items: readonly PluginItem[], entries: InstalledEntry[]): string {
  switch (entry.page) {
    case "main": return connectAppsTabLabel(tab);
    case "botsFor": return t("connectApps.entry.bots");
    case "detail": {
      const item = items.find((candidate) => candidate.key === entry.key);
      return item ? detailIdentity(item, entries).name : t("connectApps.back");
    }
    case "skill": return entry.name ?? t("connectApps.skill.new");
    case "github": return t("myConnections.github.title");
    case "mac-messages": return t("connectApps.mac.messages.rowTitle");
    case "connector": return t("connectApps.addCustomConnector");
    case "tailscale": return t("connectApps.tailscale.title");
  }
}
