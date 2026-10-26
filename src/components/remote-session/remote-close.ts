/** First click asks. The next click on the same session closes (the panel's
 * Close and the screen card's Stop share it). */
export function remoteClosePhase(confirmId: string | null, id: string): "ask" | "commit" {
  return confirmId === id ? "commit" : "ask";
}
