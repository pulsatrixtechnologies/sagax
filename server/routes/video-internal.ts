import { z } from "zod";
import { VideoGenerations, VideoJobError, type VideoScope } from "../video-generation.ts";
import { videoGenerationSchema } from "../video-provider.ts";
import type { InternalCapabilityView, InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

export const VIDEO_INTERNAL_PATH = "/api/internal/video";
const commandSchema = z.object({
  action: z.enum(["generate", "status", "list", "cancel", "retry"]).default("generate"),
  job_id: z.string().uuid().optional(),
  request_key: z.string().trim().min(1).max(100).optional(),
  offset: z.number().int().nonnegative().optional(),
}).passthrough();
export function createVideoInternalRoutes(deps: {
  jobs(): VideoGenerations;
  scope(capability: InternalCapabilityView): VideoScope | null;
  active(capability: InternalCapabilityView): boolean;
  requestKey(capability: InternalCapabilityView): string;
  image(capability: InternalCapabilityView, reference: string): Promise<string>;
}): InternalRouteHandler {
  return async ({ path, method, res, json, capability, readBody }) => {
    if (path !== VIDEO_INTERNAL_PATH || method !== "POST") return PASS;
    const raw = await readBody();
    const parsed = commandSchema.safeParse(raw);
    if (!parsed.success) return json(res, 400, { error: "action is generate, status, list, cancel or retry; job_id must be a video job id." });
    const scope = deps.scope(capability);
    if (!scope) return json(res, 403, { error: "Video generation needs the person this conversation speaks for." });
    const { action, job_id: id, request_key: requestKey } = parsed.data;
    try {
      const jobs = deps.jobs();
      if (action === "list") return json(res, 200, jobs.list(scope, parsed.data.offset));
      if (action !== "generate") {
        if (!id) return json(res, 400, { error: "job_id is required for status, cancel and retry." });
        const result = action === "status" ? jobs.status(scope, id) : action === "cancel" ? jobs.cancel(scope, id) : await jobs.retry(scope, id, () => deps.active(capability));
        return json(res, 200, result);
      }
      const input = videoGenerationSchema.safeParse(raw);
      if (!input.success) return json(res, 400, { error: "Provide prompt (1-2000 characters), duration (1-15 seconds), a supported aspect_ratio and resolution (480p, 720p or 1080p). image must reference an image already attached in this turn." });
      const image = input.data.image ? await deps.image(capability, input.data.image) : undefined;
      const result = await jobs.generate(scope, input.data, requestKey ?? deps.requestKey(capability), image, () => deps.active(capability));
      return json(res, 200, result);
    } catch (error) {
      return json(res, error instanceof VideoJobError ? error.status : 502, {
        error: error instanceof VideoJobError ? error.message : "Video generation could not start. Check the video jobs before starting another potentially billable generation.",
      });
    }
  };
}
