// One installed-plugin record for bot, personal and organization stores.
// Contents and execution stay in BotPlugins; a store chooses its scope.
import { z } from "zod";

const pluginMcpSpecSchema = z.union([
  z.object({ command: z.string(), args: z.array(z.string()), env: z.record(z.string(), z.string()) }).strict(),
  z.object({ type: z.enum(["http", "sse"]), url: z.string(), headers: z.record(z.string(), z.string()) }).strict(),
]);

export const capabilityPluginRecordSchema = z.object({
  name: z.string(),
  marketplace: z.string(),
  description: z.string().optional(),
  version: z.string().optional(),
  revision: z.string().optional(),
  enabled: z.boolean(),
  installedAt: z.number(),
  installedBy: z.string().optional(),
  updatedAt: z.number(),
  removed: z.array(z.string()),
  declaredMcpServers: z.array(z.string()),
  /** Private execution specs. Listings carry names only. */
  mcpServers: z.record(z.string(), pluginMcpSpecSchema).optional(),
  lifecycleHooks: z.number().int().min(0).max(100).optional(),
}).strict();

export const capabilityPluginStateSchema = z.object({
  version: z.literal(2),
  plugins: z.record(z.string(), capabilityPluginRecordSchema),
  lifecycleHooksEnabled: z.boolean().optional(),
}).strict();

export type CapabilityPluginState = z.infer<typeof capabilityPluginStateSchema>;
export const capabilityPluginValuesSchema = z.record(z.string(), z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])));
export type CapabilityPluginValues = z.infer<typeof capabilityPluginValuesSchema>;
