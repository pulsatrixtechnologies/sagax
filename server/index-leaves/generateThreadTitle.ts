// @ts-nocheck
/** generateThreadTitle (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createGenerateThreadTitle(getHost: () => Host): any {
async function generateThreadTitle(   provider: { generateText?: (prompt: string, options?: { signal?: AbortSignal }) => Promise<string> },   text: string,   source: ThreadTitleSource = "first-message", ) {
  void getHost();

  const prompt = threadTitlePrompt(text, source);
  const expiry = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // the race caps the wait; the signal aborts the provider call itself,
    // which every generateText driver that can honor it does
    const reply = await Promise.race([
      provider.generateText!(prompt, { signal: expiry.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expiry.abort();
          reject(new Error("thread title timed out"));
        }, 10_000);
      }),
    ]);
    return titleFromLlm(reply);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

}
  return generateThreadTitle;
}
