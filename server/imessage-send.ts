// Send one iMessage or SMS. The AppleScript talks to Messages and can
// launch it. Tests inject a sender and never call the script runner.
import { execFile } from "node:child_process";

import type { MessageService } from "../shared/imessage.ts";

export type ImessageSend = {
  to: string;
  text: string;
  service: MessageService;
};

export type ImessageSender = {
  send(input: ImessageSend): Promise<{ service: string; via: "participant" }>;
};

/** AppleScript string literal. */
export function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
}

/** One send to a single handle. No group, no chat id left unresolved. */
export function imessageSendScript(input: { to: string; text: string; service: "iMessage" | "SMS" | "auto" }): string {
  const service = input.service === "SMS" ? "SMS" : "iMessage";
  return [
    `tell application "Messages"`,
    `set targetService to first service whose service type is ${service}`,
    `set targetBuddy to participant ${appleScriptString(input.to)} of targetService`,
    `send ${appleScriptString(input.text)} to targetBuddy`,
    `end tell`,
  ].join("\n");
}

export function createOsascriptSender(run: typeof execFile = execFile): ImessageSender {
  return {
    send(input) {
      const service = input.service === "SMS" ? "SMS" : "iMessage";
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
