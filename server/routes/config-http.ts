/**
 * App config HTTP routes (#1388 wave 2 P5): GET and PUT/PATCH /api/config.
 *
 * The GET view and the early PUT refusals (admin-only fields, hosted
 * providers, managed profile, experimental-only) live here. The ~600-line
 * save/commit pipeline (Boat/VPS/browser/provider reload) is injected as
 * `applyPatch` so this module stays readable and never imports index.ts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

export interface ConfigWriteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  auth: RequestAuth;
  body: unknown;
  json: RouteContext["json"];
}

export interface ConfigHttpDeps {
  /** Full GET /api/config payload for this caller (already person/org shaped). */
  configView(auth: RequestAuth): unknown;
  identityKind(): string;
  callerCan(auth: RequestAuth, key: string): boolean;
  /** First address field (`url` / `*Url`) in a patch, as a dotted path. */
  configAddressField(value: unknown): string | undefined;
  /** First provider key/token field in a patch, as a dotted path. */
  configProviderKeyField(value: unknown): string | undefined;
  /** Field name a server.experimental-only delegate may not write, or null. */
  experimentalOnlyConfigViolation(body: unknown): string | null | undefined;
  permissionRefusal(key: string): { error: string; permission: string; message?: string };
  hostedModels(): boolean;
  HOSTED_PROVIDER_SETTINGS_ERROR: string;
  profileManagedFor(auth: RequestAuth): boolean;
  writesManagedProfile(body: unknown): boolean;
  MANAGED_PROFILE_REFUSAL: { error: string; code?: string };
  /**
   * The validated write + post-commit pipeline. Writes the HTTP response
   * via `json` (or throws). Called only after early refusals pass.
   */
  applyPatch(ctx: ConfigWriteContext): Promise<void>;
}

const CONFIG_PATH = "/api/config";

export function createConfigHttpRoutes(deps: ConfigHttpDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (path !== CONFIG_PATH) return PASS;

    if (method === "GET") {
      return json(res, 200, deps.configView(auth));
    }

    if (method !== "PUT" && method !== "PATCH") return PASS;

    const body = await readBody(req);
    // 2026-10-19: a person an admin gave server.settings never changes who
    // is an admin (the sign-in lists), the operator's own profile, or the
    // organization block (its policies have their own route, where the
    // interim attach window stays an admin's).
    if (deps.identityKind() === "perspicax" && !auth.scopes.includes("admin") && body && typeof body === "object") {
      // Security review 2026-10-19: nor a provider's endpoint (every bot on
      // the workspace key, admins' too, would talk to it), the OpenAI-
      // compatible engines, or the maintainer switches that reach the host.
      // Security review 2026-10-19, pass 3: nor any address in any block
      // (decider.baseUrl, tts.baseUrl, imageGen.customUrl,
      // browserEngine.attachCdpUrl, a provider's url...): a delegate never
      // points the server at an endpoint they control.
      const record = body as Record<string, unknown>;
      const hostFeature = record.features && typeof record.features === "object"
        ? ["sharedComputers", "claudeUserMcp", "vpsComputer", "boatComputer"].find((key) => Object.hasOwn(record.features as object, key))
        : undefined;
      // vps (an SSH alias of the server) and box (whose account runs the
      // computers) choose where bots run: an admin's, like an address.
      const field = ["signIn", "profile", "organization", "openaiCompat", "vps", "box"].find((key) => Object.hasOwn(body, key))
        ?? deps.configAddressField(record) ?? deps.configProviderKeyField(record) ?? (hostFeature ? `features.${hostFeature}` : undefined);
      if (field) {
        return json(res, 403, {
          error: field.toLowerCase().endsWith("url")
            ? "Only an organization admin can change an address the server connects to."
            : field === deps.configProviderKeyField(record)
              ? "Only an organization admin can change a provider key of the server."
              : "Only an organization admin can change this part of the settings.",
          code: "admin_only_field",
          field,
        });
      }
      // 2026-10-22 the config write now opens to server.experimental
      // (request-auth.ts). A delegate who holds only that key, not
      // server.settings, may flip the experiments of Settings > Experimental
      // and nothing else: refuse any other field here (defense in depth; the
      // client hides those controls from them too).
      if (!deps.callerCan(auth, "server.settings")) {
        const forbidden = deps.experimentalOnlyConfigViolation(body);
        if (forbidden) {
          return json(res, 403, { ...deps.permissionRefusal("server.settings"), code: "admin_only_field", field: forbidden });
        }
      }
    }
    if (deps.hostedModels() && ["instances", "anthropic", "openai", "openrouter", "openaiCompat", "xai", "mistral", "cerebras", "groq", "opencodeGo"].some((key) => Object.hasOwn(body as object, key))) {
      return json(res, 403, { error: deps.HOSTED_PROVIDER_SETTINGS_ERROR });
    }
    if (deps.profileManagedFor(auth) && deps.writesManagedProfile(body)) {
      return json(res, 403, deps.MANAGED_PROFILE_REFUSAL);
    }

    await deps.applyPatch({ req, res, url, auth, body, json });
  };
}
