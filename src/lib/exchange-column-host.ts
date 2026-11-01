// Shared host for the bot-to-bot exchange sheet (and routine run sheets that
// reuse it). ChatView and GroupView register their chat column; sheets opened
// from the bot panel (outside that tree) still portal into the same place.
type Listener = () => void;

let host: HTMLElement | null = null;
const listeners = new Set<Listener>();

export function setExchangeColumnHost(node: HTMLElement | null): void {
  if (host === node) return;
  host = node;
  for (const listener of listeners) listener();
}

export function getExchangeColumnHost(): HTMLElement | null {
  return host;
}

export function subscribeExchangeColumnHost(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
