// OpenAI-compatible base URL: the driver appends /chat/completions and
// /models itself. A pasted full endpoint (".../v1/chat/completions") must
// be kept as its base at save and at call (2026-11-05, #2022). Cohere's
// public API serves OpenAI compatibility on /compatibility/v1; a private
// Cohere deployment serves it on /v1 (its /compatibility/v1 is 404,
// #2054). Either base is left alone.

const ENDPOINT_SUFFIX = /\/(?:chat\/completions|completions|responses|models)\/*$/iu;

/** Drop a trailing chat/completions (or completions / responses / models)
 * path segment and any trailing slashes. Shared by save-time and call-time
 * normalization. */
export function stripOpenAiEndpointSuffix(url: string): string {
  return url.trim().replace(/\/+$/u, "").replace(ENDPOINT_SUFFIX, "").replace(/\/+$/u, "");
}
