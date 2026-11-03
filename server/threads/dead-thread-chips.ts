// Read-time mark on a navigation chip ("Go to conversation", "Messaged
// <bot>") whose target thread was deleted. A viewer who cannot see that
// bot's threads (organization server, another person's bot) cannot tell from
// its own store, so the server says so. Nothing is stored: the mark follows
// the thread list at each read, and a returned message is a copy.

type Marked = { threadId?: string; gone?: boolean };

function remarked<R extends Marked>(target: R, exists: boolean): R | null {
  if (!target.threadId) return null;
  if (exists === (target.gone !== true)) return null;
  const { gone: _gone, ...rest } = target;
  return (exists ? rest : { ...rest, gone: true }) as R;
}

export function markDeadThreadChip<T>(message: T, threadExists: (threadId: string) => boolean): T {
  const chip = message as { threadRef?: Marked; comm?: Marked };
  if (chip.threadRef) {
    const next = remarked(chip.threadRef, threadExists(chip.threadRef.threadId!));
    if (next) return { ...message, threadRef: next };
  }
  if (chip.comm) {
    const next = remarked(chip.comm, chip.comm.threadId ? threadExists(chip.comm.threadId) : true);
    if (next) return { ...message, comm: next };
  }
  return message;
}
