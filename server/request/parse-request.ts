// #1388 wave 4 step 2: first named handleRequest step.
// Pure URL parse for an incoming HTTP request. Never imports server/index.ts.
import type { IncomingMessage, ServerResponse } from "node:http";

export type ParseRequestJson = (
  res: ServerResponse,
  status: number,
  body: unknown,
) => void;

export type ParsedRequest = {
  url: URL;
  path: string;
  method: string;
};

/** Parse the request URL. On failure answers 400 and returns null. */
export function parseRequest(
  req: IncomingMessage,
  res: ServerResponse,
  port: number,
  reply: ParseRequestJson,
): ParsedRequest | null {
  let url: URL;
  try {
    url = new URL(req.url ?? "/", `http://localhost:${port}`);
  } catch {
    reply(res, 400, { error: "invalid request URL" });
    return null;
  }
  return {
    url,
    path: url.pathname,
    method: req.method ?? "GET",
  };
}
