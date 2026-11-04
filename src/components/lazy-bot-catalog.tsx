import { lazyScreen } from "./lazy-screen";

// Leaf lazy module: PluginsPanel opens the catalog pane, and lazy-screens
// loads PluginsPanel, so the pane lives here to keep the import graph acyclic.
export const BotCatalogPane = lazyScreen("BotCatalogPane", async () => (await import("./bot-catalog/BotCatalogModal")).BotCatalogPane);
