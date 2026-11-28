import { z } from "zod";

/** Blind-pair fixture harness types (#5533 / #2644). Offline only: two
 * scripted assistants, a frozen rubric under sha256, and a deterministic
 * fixture judge. No live LLM and no network. */

export const CRITERIA = ["exactness", "completeness", "language", "format", "length", "latency", "refusal"] as const;
export type Criterion = (typeof CRITERIA)[number];

export const FAMILIES = ["P-1", "P-2", "P-3", "P-4"] as const;
export type Family = (typeof FAMILIES)[number];

export const expectSchema = z.object({
  /** Substrings the useful answer must include (P-1 exactness). */
  mustContain: z.array(z.string()).default([]),
  /** Substrings that must not appear (P-1 / P-4). */
  mustNotContain: z.array(z.string()).default([]),
  /** Required reply language tag: "en" or "fr". */
  language: z.enum(["en", "fr"]).optional(),
  /** Required shape hint the judge checks with a simple rule. */
  format: z.enum(["plain", "numbered-list", "json-object", "one-word"]).optional(),
  /** Soft upper bound on word count (P-2 length). */
  maxWords: z.number().int().positive().optional(),
  /** When true the useful reply is a refusal (P-4). */
  refuse: z.boolean().default(false),
  /** Useful-result latency ceiling in ms (P-3). */
  usefulWithinMs: z.number().int().positive().optional(),
});

export const taskSchema = z.object({
  id: z.string().min(1),
  family: z.enum(FAMILIES),
  prompt: z.string().min(1),
  context: z.string().default(""),
  expect: expectSchema,
});

export type TaskExpect = z.infer<typeof expectSchema>;
export type BlindPairTask = z.infer<typeof taskSchema>;

export const rubricFileSchema = z.object({
  family: z.enum(FAMILIES),
  version: z.string().min(1),
  tasks: z.array(taskSchema).min(5),
});

export type RubricFile = z.infer<typeof rubricFileSchema>;

export const manifestSchema = z.object({
  version: z.string().min(1),
  files: z.array(z.object({
    file: z.string().min(1),
    family: z.enum(FAMILIES),
    sha256: z.string().length(64),
  })).min(1),
});

export type BlindPairManifest = z.infer<typeof manifestSchema>;

export type AssistantId = "sagax-fixture" | "reference-fixture";

export type AssistantReply = {
  assistantId: AssistantId;
  text: string;
  latencyMs: number;
};

export type AnonymizedSide = {
  label: "Assistant A" | "Assistant B";
  text: string;
  latencyMs: number;
};

export type CriterionGap = {
  criterion: Criterion;
  assistantA: "pass" | "fail" | "n/a";
  assistantB: "pass" | "fail" | "n/a";
  detail: string;
};

export type PairVerdict = {
  taskId: string;
  family: Family;
  /** Mapping kept sealed until after the report is written for a live sitting;
   * the fixture report may reveal it under --reveal. */
  assignment: {
    assistantA: AssistantId | "sealed";
    assistantB: AssistantId | "sealed";
  };
  sides: [AnonymizedSide, AnonymizedSide];
  gaps: CriterionGap[];
};

export type BlindPairReport = {
  version: 1;
  manifestVersion: string;
  manifestSha256: string;
  seed: number;
  pairCount: number;
  families: Family[];
  pairs: PairVerdict[];
  /** Gaps rolled up per criterion across pairs. Never a single score. */
  gapsByCriterion: Record<Criterion, { aFails: number; bFails: number; compared: number }>;
};
