// The job runtime's public surface (docs/runtime-contract.md). The host
// imports from here; nothing in the module imports the host.
export * from "./types.ts";
export { openRuntimeStore, type RuntimeStore } from "./store.ts";
export { Runtime, type BeginRequest, type RetryResult, type RuntimeOptions } from "./runtime.ts";
export {
  attemptOutcomeFor,
  byOldestFirst,
  nextAttemptNumber,
  openAttempt,
  shouldResumeAfterReport,
  type Attempt,
  type AttemptOutcome,
} from "./attempts.ts";
export { assignmentLevel, type LevelInput } from "./level.ts";
export { composeEnvelope, composeReport, composeResume, escapeEnvelope, ENVELOPE_MARK } from "./envelope.ts";
export { checkInvariants, replayStatus } from "./invariants.ts";
export { engineCapabilities, ENGINE_KINDS, type EngineCapabilities } from "./capabilities.ts";
export {
  STAGE_DETAIL,
  STAGE_LABEL_KEYS,
  STAGE_LABELS,
  STAGE_PRIORITY,
  stageLabel,
  stageLabelKey,
  stageOf,
  type JobStage,
  type StageAssignment,
  type StageEvent,
} from "./stage.ts";
export {
  heldSkipDetail,
  humanMessageDetail,
  isHeld,
  reservedSlotAdmission,
  shouldDeliverInput,
  wakeKind,
  type DeliverDecision,
  type InputSource,
  type WakeKind,
} from "./hold.ts";
