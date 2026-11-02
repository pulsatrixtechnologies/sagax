// About opens as its own centred modal (Settings > About and the app menu).
// A tiny bus keeps that call out of the store and out of prop drilling.

type AboutListener = () => void;

const listeners = new Set<AboutListener>();

export function requestAbout(): void {
  for (const listener of listeners) listener();
}

export function subscribeAbout(listener: AboutListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
