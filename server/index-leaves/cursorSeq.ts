// @ts-nocheck
/** cursorSeq (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCursorSeq(getHost: () => Host): any {
function cursorSeq(raw: string | string[] | undefined) {
  const host = getHost();

  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const [stream, seq] = value.split(":");
  if (stream !== host.STREAM_ID) return null;
  const parsed = Number(seq);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;

}
  return cursorSeq;
}
