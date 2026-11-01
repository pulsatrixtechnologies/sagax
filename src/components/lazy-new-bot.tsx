import { lazyScreen } from "./lazy-screen";

export const NewBotDialog = lazyScreen("NewBotDialog", async () => (await import("./NewBotDialog")).NewBotDialog);
