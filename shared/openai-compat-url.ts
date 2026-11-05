// OpenAI-compatible base URL: the driver appends /chat/completions and
// /models itself. A pasted full endpoint (".../v1/chat/completions") must
// be kept as its base at save and at call (2026-11-05, #2022). Cohere's
// OpenAI-compatible address is /compatibility/v1 and is left alone.

const ENDPOINT_SUFFIX = /\/(?:chat\/completions|completions|responses|models)\/*$/iu;

/** Drop a trailing chat/completions (or completions / responses / models)
 * path segment and any trailing slashes. Shared by save-time and call-time
 * normalization. */
export function stripOpenAiEndpointSuffix(url: string): string {
  return url.trim().replace(/\/+$/u, "").replace(ENDPOINT_SUFFIX, "").replace(/\/+$/u, "");
}
