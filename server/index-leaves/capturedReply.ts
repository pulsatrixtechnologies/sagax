// @ts-nocheck
/** capturedReply (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCapturedReply(getHost: () => Host): any {
function capturedReply(): { res: ServerResponse; reply: () => { status: number; body: Record<string, unknown> } | null } {
  void getHost();
  let status = 0;
  let text = "";
  const res = {
    req: { method: "POST", headers: {} },
    writeHead(code: number) { status = code; return res; },
    setHeader() { return res; },
    getHeader() { return undefined; },
    hasHeader() { return false; },
    end(data?: unknown) { text = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf8") : ""; return res; }
  } as unknown as ServerResponse;
  return {
    res,
    reply: () => {
      if (!status) return null;
      try { return { status, body: JSON.parse(text) as Record<string, unknown> }; } catch { return { status, body: {} }; }
    }
  };
}
  return capturedReply;
}
