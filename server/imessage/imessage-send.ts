// Send one iMessage or SMS. The AppleScript talks to Messages and can
// launch it. Tests inject a sender and never call the script runner.
import { execFile } from "node:child_process";

import type { MessageService } from "../../shared/imessage.ts";

export type ImessageSend = {
  to: string;
  text: string;
  service: MessageService;
  /** Absolute path already checked to sit inside the bot's folder. */
  file?: string;
};

export type ImessageSender = {
  send(input: ImessageSend): Promise<{ service: string; via: "participant" }>;
};

/** AppleScript string literal. */
export function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
}

/** One send to a single handle. No group, no chat id left unresolved.
 * A file is a POSIX file on iMessage. SMS never carries one. */
export function imessageSendScript(input: { to: string; text: string; service: "iMessage" | "SMS" | "auto"; file?: string }): string {
  const service = input.file ? "iMessage" : input.service === "SMS" ? "SMS" : "iMessage";
  const lines = [
    `tell application "Messages"`,
    `set targetService to first service whose service type is ${service}`,
    `set targetBuddy to participant ${appleScriptString(input.to)} of targetService`,
  ];
  if (input.text.trim()) lines.push(`send ${appleScriptString(input.text)} to targetBuddy`);
  if (input.file) lines.push(`send POSIX file ${appleScriptString(input.file)} to targetBuddy`);
  lines.push(`end tell`);
  return lines.join("\n");
}

export function createOsascriptSender(run: typeof execFile = execFile): ImessageSender {
  return {
    send(input) {
      const service = input.file || input.service !== "SMS" ? "iMessage" : "SMS";
      const script = imessageSendScript({ ...input, service });
      return new Promise((resolve, reject) => {
        run("osascript", ["-e", script], { timeout: 20_000 }, (error, stdout, stderr) => {
          if (error) {
            const detail = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr ?? "");
            reject(new Error(detail.trim() || "Messages did not send"));
            return;
          }
          void stdout;
          resolve({ service, via: "participant" });
        });
      });
    },
  };
}
