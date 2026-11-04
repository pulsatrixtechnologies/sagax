// Settings pages that open only when their nav row is selected. Keeping them
// out of the SettingsModal chunk means opening Settings downloads the shell
// first; each heavy page arrives on demand (or via idle preload of Settings).
import { lazyScreen } from "./lazy-screen";

export const AppearanceSettings = lazyScreen("AppearanceSettings", async () => (await import("./settings/AppearanceSettings")).AppearanceSettings);
export const CredentialsSettings = lazyScreen("CredentialsSettings", async () => (await import("./settings/CredentialsSettings")).CredentialsSettings);
export const EnginesSettings = lazyScreen("EnginesSettings", async () => (await import("./EnginesSettings")).EnginesSettings);
export const ExperimentalSettings = lazyScreen("ExperimentalSettings", async () => (await import("./settings/ExperimentalSettings")).ExperimentalSettings);
export const ImportSettings = lazyScreen("ImportSettings", async () => (await import("./settings/ImportSettings")).ImportSettings);
export const LocalComputerSection = lazyScreen("LocalComputerSection", async () => (await import("./LocalComputerSection")).LocalComputerSection);
export const ProvidersSettings = lazyScreen("ProvidersSettings", async () => (await import("./settings/ProvidersSettings")).ProvidersSettings);
export const UsageSection = lazyScreen("UsageSection", async () => (await import("./UsageSection")).UsageSection);
export const VoiceSettingsPage = lazyScreen("VoiceSettingsPage", async () => (await import("./EnginesSettings")).VoiceSettingsPage);
export const WorkspaceBackupSettings = lazyScreen("WorkspaceBackupSettings", async () => (await import("./WorkspaceBackupSettings")).WorkspaceBackupSettings);
