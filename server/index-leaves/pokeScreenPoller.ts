// @ts-nocheck
/** pokeScreenPoller (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPokeScreenPoller(getHost: () => Host): any {
function pokeScreenPoller(threadId: string, touches: boolean, surface?: "browser" | "computer") {
  const host = getHost();

  const entry = host.screenPollers.get(threadId);
  if (!entry) return;
  // the same signal, read twice: a completed computer tool is both the
  // reason to refresh the preview NOW and — when it acted on or looked at
  // the screen — the proof that this turn's final frame is worth settling
  // into the transcript. A shell command or a status read earns only the
  // refresh: under the Claude driver every tool of the computer server is
  // named mcp__computer__*, and matching that alone used to append an
  // untouched desktop to every curl-and-answer reply.
  if (touches) entry.touched = true;
  // Picture the surface the tool acted on. Only a touching tool moves this:
  // a status read on the computer must not redirect the picture away from a
  // page the browser is still showing.
  if (touches && surface) entry.surface = surface;
  void Promise.resolve(entry.capture()).catch(host.reportBackgroundError);

}
  return pokeScreenPoller;
}
