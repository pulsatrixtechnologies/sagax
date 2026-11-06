// Fire-and-forget calls end with `.catch(reportBackgroundError)`: the failure is
// logged once per minute per message instead of vanishing or crashing the process.
const lastSeen = new Map<string, number>();
const WINDOW_MS = 60_000;

export function reportBackgroundError(error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	const now = Date.now();
	const previous = lastSeen.get(message);
	if (previous !== undefined && now - previous < WINDOW_MS) return;
	if (lastSeen.size > 500) lastSeen.clear();
	lastSeen.set(message, now);
	console.warn(`[background] ${message}`);
}
