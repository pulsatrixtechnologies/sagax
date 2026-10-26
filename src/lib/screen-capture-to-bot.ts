// Capture the screen to a bot (parity R7, system 12): the shell's global
// key (electron/screen-capture-hotkey.mjs) hands over one PNG; it becomes an
// image attachment in the open bot's composer draft, the same keyed draft
// the composer reads (src/lib/drafts.ts), so nothing here touches the
// composer itself. Nothing is sent: the person writes and sends it.

export interface CaptureBot {
  id: string;
  threadId: string;
  hidden?: boolean;
  modelSelection: { instanceId: string };
}

export interface CaptureInstance {
  instanceId: string;
  capabilities?: { images?: boolean } | null;
}

export interface CaptureTarget {
  botId: string;
  draftId: string;
  /** The bot is not on screen: open it first. */
  open: boolean;
  /** Its engine can open a picture (else the page says so and attaches nothing). */
  images: boolean;
}

/** The open bot, else the first visible one; null without any bot. */
export function captureTarget(input: { selectedId: string; bots: readonly CaptureBot[]; instances: readonly CaptureInstance[] }): CaptureTarget | null {
  const selected = input.bots.find((bot) => bot.id === input.selectedId);
  const bot = selected ?? input.bots.find((candidate) => !candidate.hidden);
  if (!bot) return null;
  const images = Boolean(input.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId)?.capabilities?.images);
  return { botId: bot.id, draftId: `bot:${bot.id}:${bot.threadId}`, open: !selected, images };
}

const two = (value: number) => String(value).padStart(2, "0");

/** The picture as a File, named like a macOS screenshot (local time). */
export function captureFile(base64: string, at = new Date()): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const name = `Screenshot ${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}.${two(at.getMinutes())}.${two(at.getSeconds())}.png`;
  return new File([bytes], name, { type: "image/png" });
}

/** The message for a capture the shell could not take, in the words of the
 * person's system (System Settings on macOS, Settings on Windows). */
export function captureErrorKey(error: { error: "permission" | "unavailable"; platform: "darwin" | "win32" | "other" }):
  "screenCapture.permissionMac" | "screenCapture.unavailableMac" | "screenCapture.unavailableWindows" | "screenCapture.unavailable" {
  if (error.platform === "darwin") return error.error === "permission" ? "screenCapture.permissionMac" : "screenCapture.unavailableMac";
  if (error.platform === "win32") return "screenCapture.unavailableWindows";
  return "screenCapture.unavailable";
}
