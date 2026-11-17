// The small pill a reference wears in a bot's text: a GitHub pull request,
// issue or commit, and a record of a connected product (#4507). One class,
// shared, so the two never drift apart. Left to right and isolated, so a
// number such as "#2547" never turns into "2547#" in a right-to-left line.
export const REF_PILL_CLASS =
  "inline-flex items-baseline gap-1 whitespace-nowrap rounded-full bg-inset px-1.5 align-baseline font-mono text-[0.88em] text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus [unicode-bidi:isolate]";
