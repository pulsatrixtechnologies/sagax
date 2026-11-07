// The shapes of the files inside a bot archive, read with zod on import.
import { z } from "zod";
import { botRuntimeSettingsShape } from "./bot-runtime-settings.ts";
import { isApprovalMode } from "../../shared/approval-mode.ts";
import { VOICE_MODE_MAX_SPEED, VOICE_MODE_MIN_SPEED, isVoiceModeLanguage } from "../../shared/voice-mode.ts";
import { EFFORT_LEVELS } from "../../shared/wire.ts";

export const effortSchema = z.enum(EFFORT_LEVELS);
export const selectionSchema = z.object({
  instanceId: z.string().min(1).max(80), model: z.string().min(1).max(200), effort: effortSchema.optional(), variant: z.string().max(80).optional(), auto: z.literal(true).optional(),
  fast: z.object({ instanceId: z.string().min(1).max(80), model: z.string().min(1).max(200) }).optional(),
});
export const settingsSchema = z.object({
  modelSelection: selectionSchema.optional(),
  fallback: z.array(z.object({ instanceId: z.string().min(1).max(80), model: z.string().min(1).max(200) })).max(10).optional(),
  maxConcurrentThreads: botRuntimeSettingsShape.maxConcurrentThreads,
  maxParallelPerPerson: botRuntimeSettingsShape.maxParallelPerPerson,
  busySend: botRuntimeSettingsShape.busySend,
  turnLimits: botRuntimeSettingsShape.turnLimits,
  automaticRecovery: z.object({ enabled: z.boolean(), backup: selectionSchema.optional() }).optional(),
  autoApprove: z.boolean().optional(),
  approvalMode: z.string().refine(isApprovalMode).optional(),
  speakReplies: z.boolean().optional(),
  finishUntil: z.string().max(400).optional(),
  finishUntilMaxRounds: z.number().int().min(1).max(50).optional(),
  voice: z.string().max(200).optional(),
  voiceNotes: z.boolean().optional(),
  voiceSpeed: z.number().finite().min(VOICE_MODE_MIN_SPEED).max(VOICE_MODE_MAX_SPEED).optional(),
  voiceLanguage: z.string().refine(isVoiceModeLanguage).optional(),
  emailDrafts: z.boolean().optional(),
  memeReplies: z.enum(["auto", "off"]).optional(),
  memoryEnabled: z.boolean().optional(),
  loopGuard: z.boolean().optional(),
  // read as the bot reads it (shared/team-memory-sharing.ts): an archive
  // written before export normalized it still imports, unknown as private
  teamMemorySharing: z.unknown().optional(),
  memoryUpkeep: z.boolean().optional(),
  skillLearning: z.boolean().optional(),
  builtinPlugins: z.record(z.string(), z.boolean()).optional(),
  helperModel: z.boolean().optional(),
  parkDirectMessages: z.boolean().optional(),
  approvePeerComms: z.boolean().optional(),
  localPrompt: z.enum(["compact", "full"]).optional(),
  peers: z.array(z.string().max(128)).max(500).optional(),
  outbound: z.object({ policy: z.enum(["ask", "allow"]), dailyCap: z.number().int().min(0).max(100_000) }).optional(),
  assignedSkills: z.array(z.string().max(64)).max(200).optional(),
  section: z.string().max(60).optional(),
  sectionId: z.string().regex(/^sec_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).optional(),
  managedSections: z.array(z.string().max(60)).max(100).optional(),
  projects: z.array(z.object({ id: z.string().min(1).max(64), name: z.string().min(1).max(120), emoji: z.string().max(16).optional() })).max(200).optional(),
  playbooks: z.array(z.object({ key: z.string().max(64), name: z.string().max(100), summary: z.string().max(300), triggers: z.array(z.string().max(100)).max(30), instructions: z.string().max(24_000) })).max(80).optional(),
  pinned: z.boolean().optional(),
});
export const hostSchema = z.object({
  computer: z.enum(["cloud", "vm", "local", "browser", "off"]).optional(),
  cloudBackend: z.enum(["box", "vps"]).optional(),
  autoStartVps: z.boolean().optional(),
  cwd: z.string().max(4_096).optional(),
  browser: z.boolean().optional(),
  browserProfile: z.string().max(200).optional(),
  mcpServers: z.array(z.string().max(64)).max(100).optional(),
  alwaysAllow: z.array(z.string().max(1_024)).max(500).optional(),
});
export const routineSchema = z.object({
  name: z.string(), prompt: z.string(), target: z.string().optional(), runOn: z.string().optional(), schedule: z.unknown(),
  durationMinutes: z.number().optional(), timeoutMinutes: z.number().optional(), continuity: z.boolean().optional(), overlap: z.enum(["skip", "queue"]).optional(),
  sourceThreadId: z.string().optional(), resultsThreadId: z.string().optional(),
});
export const webhookSchema = z.object({
  name: z.string(), prompt: z.string(), runOn: z.enum(["maus", "cloud"]).optional(), delivery: z.enum(["run", "post"]).optional(),
  eventTypes: z.array(z.string()).max(20).optional(), maxPendingRuns: z.number().int().optional(),
  // A typed trigger's provider, events, filters and automation settings;
  // the webhook manager validates it on create like any other.
  source: z.record(z.string(), z.unknown()).optional(),
});

/** A typed trigger's settings as exported: the provider, events, filters,
 * rate limit, tenant, Graph connector name and resource, poller server. No
 * secret ever: not the signing secret, the Graph clientState or
 * subscription, the poller's password or ICS link (those never sit on the
 * source), and not the user name or connector account either, which belong
 * to this server's people. */

export const sharingSchema = z.object({
  visibility: z.union([z.literal("everyone"), z.literal("admins"), z.object({ people: z.array(z.string().max(320)).max(1_000) })]).optional(),
  grants: z.array(z.union([
    z.object({ email: z.string().max(320), level: z.enum(["use", "run", "edit", "manage"]) }),
    z.object({ team: z.string().max(64), level: z.enum(["use", "run", "edit", "manage"]) }),
  ])).max(1_000).default([]),
});
export const tasksSchema = z.object({ active: z.string().max(128).optional(), tasks: z.array(z.record(z.string(), z.unknown())).max(5_000) });
export const threadSchema = z.object({ activeLeafId: z.string().max(128).nullable().optional(), messages: z.array(z.record(z.string(), z.unknown())).max(200_000) });
