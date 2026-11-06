// @ts-nocheck
/** streamOpenedHttpFile (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStreamOpenedHttpFile(getHost: () => Host): any {
function streamOpenedHttpFile(   req: IncomingMessage,   res: ServerResponse,   file: OpenedMessageFile,   headers: Record<string, string>, ) {
  void getHost();

  // no-transform keeps Caddy's encode, Cloudflare and other proxies from
  // compressing a body whose Content-Length and ranges are stored bytes.
  const cacheControl = headers["cache-control"] ?? "private, no-store";
  const common = {
    ...headers,
    "cache-control": /\bno-transform\b/i.test(cacheControl) ? cacheControl : `${cacheControl}, no-transform`,
    "accept-ranges": "bytes"
  };
  const rawRange = Array.isArray(req.headers.range) ? req.headers.range[0] : req.headers.range;
  const range = parseAttachmentRange(rawRange, file.bytes);
  if (range.kind === "unsatisfiable") {
    void file.handle.close().catch(() => undefined);
    res.writeHead(416, { ...common, "content-range": `bytes */${file.bytes}` });
    res.end();
    return;
  }
  if (res.destroyed) {
    void file.handle.close().catch(() => undefined);
    return;
  }
  const start = range.kind === "range" ? range.start : 0;
  const end = range.kind === "range" ? range.end : file.bytes - 1;
  res.writeHead(range.kind === "range" ? 206 : 200, {
    ...common,
    "content-length": String(Math.max(0, end - start + 1)),
    ...(range.kind === "range" ? { "content-range": `bytes ${start}-${end}/${file.bytes}` } : {})
  });
  if (end < start || res.destroyed) {
    void file.handle.close().catch(() => undefined);
    res.end();
    return;
  }
  const stream = file.stream({ start, end });
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);

}
  return streamOpenedHttpFile;
}
