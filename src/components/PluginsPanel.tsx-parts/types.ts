import type { ReactNode } from "react";
import type { MarketplaceVisibility } from "@/lib/my-connections";
import type { PluginItem } from "@/lib/plugins-model";
import type { PluginScope } from "@/lib/plugin-scope";
import type { PluginDetailProps } from "../plugins/PluginDetailView";
import type { ClaudeUnavailable, HarnessConnectorStatus, RegistryGrokAccount } from "../plugins/HarnessConnectorGroups";
import type { McpServers } from "../McpServersPanel";
import type { AccountConnectorProvider } from "../../../shared/account-connectors";
import type { DataCenter } from "../plugins/DataCenterDialog";

export interface MarketplaceListing {
  name: string;
  source: string;
  ref?: string;
  description?: string;
  /** bots with plugins from it (the workspace list only) */
  bots?: number;
  /** a token is saved for it: the bot scope's bot, or everyone's (an admin's) in the workspace list; never the token */
  hasToken?: boolean;
  /** "private" (the person who added it) or "org" (shared with everyone) */
  visibility?: MarketplaceVisibility;
  /** this viewer added it, so may change its visibility */
  mine?: boolean;
  plugins: Array<{
    name: string; description?: string; version?: string; category?: string; installed: boolean; servers: string[]; skills: string[];
    installedVersion?: string; updateAvailable?: boolean;
  }>;
}

export interface FeaturedListing {
  id: string; name: string; description: string; url: string; domain: string; auth: string; installed?: boolean; site?: string; category?: string; iconUrl?: string;
  /** the provider's data centers (Add asks which one first) */
  regions?: DataCenter[];
}

/** One page of the panel's window. The window keeps a stack of them (the
 * breadcrumb): Connect apps (its tabs) at the bottom, then what was opened
 * from it. */
export type Page =
  | { page: "main" }
  /** an installed entry's "For which bots" */
  | { page: "botsFor"; key: string }
  | { page: "detail"; key: string }
  /** a private skill's page; no name: a new skill */
  | { page: "skill"; name?: string }
  /** the GitHub connection, when no marketplace has the GitHub plugin */
  | { page: "github" }
  /** Plugins > Installed > This Mac > Messages setup (the one Mac row opens it directly, #2104) */
  | { page: "mac-messages" }
  | { page: "mac-app"; app: Exclude<import("../../../shared/mac-apps-setup.ts").MacAppSetupId, "messages"> }
  /** Connect apps > Tailscale: join a bot computer to the person's tailnet */
  | { page: "tailscale" }
  /** Connect Apps > "Add a custom connector" (Grok Bot's form) */
  | { page: "connector" }
  /** #4185: one of the person's Perspicax products */
  | { page: "product"; id: string }
  /** a plugin or skill the organization installed that is on for the person: its page, with Contents */
  | { page: "orgItem"; id: string }
  /** a vendor the organization console offers: its products as one bundle (Perspicax #2071) */
  | { page: "vendor"; key: string };

export interface HarnessAnswer {
  manageUrl?: string;
  claude?: { available: boolean; reason?: ClaudeUnavailable; connectors?: Array<{ name: string; status: HarnessConnectorStatus }> };
  codex?: { available: boolean; connectors?: Array<{ name: string; status: HarnessConnectorStatus }>; manageUrl?: string };
  /** #3358: the person's own Grok sign-ins as the connector registry knows
   * them (an organization server); absent: an older or solo server. */
  grok?: { accounts: RegistryGrokAccount[] };
  /** #4408: every provider's account connectors in one shape (absent: an
   * older server; `accountConnectorProviders` builds it from the fields above) */
  providers?: AccountConnectorProvider[];
}

export interface DetailContext {
  mcp: McpServers;
  /** the GitHub plugin's page, for a server that reads the GitHub account */
  openGithub: () => void;
  /** the GitHub plugin's key: its page shows the GitHub connection */
  githubKey: string | null;
  /** the GitHub connection (GithubAccountSection), where it is in reach */
  githubSection: ReactNode;
  /** "+ Add another account" on an MCP server: the name being typed */
  mcpAccountDraft: { server: string; label: string } | null;
  setMcpAccountDraft: (value: { server: string; label: string } | null) => void;
  items: PluginItem[];
  marketplaces: MarketplaceListing[] | null;
  installing: string | null;
  openItem: (item: PluginItem) => void;
  uninstallPlugin: (item: PluginItem) => void;
  scope: PluginScope;
  /** the bot the window was opened from, to read a plugin's files at that bot's scope */
  scopeBotId?: string | null;
  /** what an install of a plugin holds (its skills, agents, commands by name), for the scope the page is in; a person's or a bot's install links no skill row of its own */
  contentsOf?: (pluginId: string) => { skills: string[]; agents: string[]; commands: string[]; servers: string[] } | undefined;
  /** the plugin "For <bot>" (absent: no bot in reach) */
  botCard: ReactNode;
  updatePlugin: (item: PluginItem) => void;
}

export type DetailBase = Omit<PluginDetailProps, "onBack" | "onClose">;
