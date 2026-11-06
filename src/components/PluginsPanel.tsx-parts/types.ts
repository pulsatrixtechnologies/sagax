import type { ReactNode } from "react";
import type { MarketplaceVisibility } from "@/lib/my-connections";
import type { PluginItem } from "@/lib/plugins-model";
import type { PluginScope } from "@/lib/plugin-scope";
import type { PluginDetailProps } from "../plugins/PluginDetailView";
import type { ClaudeUnavailable, HarnessConnectorStatus } from "../plugins/HarnessConnectorGroups";
import type { McpServers } from "../McpServersPanel";
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
  /** Connect apps > Tailscale: join a bot computer to the person's tailnet */
  | { page: "tailscale" }
  /** Connect Apps > "Add a custom connector" (Grok Bot's form) */
  | { page: "connector" };

export interface HarnessAnswer {
  manageUrl?: string;
  claude?: { available: boolean; reason?: ClaudeUnavailable; connectors?: Array<{ name: string; status: HarnessConnectorStatus }> };
  codex?: { available: boolean; connectors?: Array<{ name: string; status: HarnessConnectorStatus }>; manageUrl?: string };
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
  /** the plugin "For <bot>" (absent: no bot in reach) */
  botCard: ReactNode;
  updatePlugin: (item: PluginItem) => void;
}

export type DetailBase = Omit<PluginDetailProps, "onBack" | "onClose">;
