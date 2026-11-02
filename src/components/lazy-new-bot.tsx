import { lazyScreen } from "./lazy-screen";

export const NewBotDialog = lazyScreen("NewBotDialog", async () => (await import("./NewBotDialog")).NewBotDialog);
export const NewBotForm = lazyScreen("NewBotForm", async () => (await import("./NewBotDialog")).NewBotForm);
