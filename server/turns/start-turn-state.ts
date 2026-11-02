// #1388 wave 4 step 3: explicit TurnState for startTurn phases.
// Fields are declared up front and mutated only through this object.
// Leaf modules take TurnState plus host deps; they must not close over
// orchestrator locals or Object.assign partial contexts.
export type StartTurnFn = (botId: string, text: string, opts?: any) => Promise<any>;

/**
 * Mutable bag for one startTurn invocation. Every cross-phase field lives
 * here before try so catch/finally and stream post-dispatch never hit TDZ.
 */
export type TurnState = {
  // Call inputs (immutable intent; opts may be replaced for routine continue).
  botId: string;
  text: string;
  opts: any;
  startTurn: StartTurnFn;

  // Admission / prepare fields (former shared lets).
  agentsMounted: any;
  answer: any;
  autoBaseSelection: any;
  autoTurn: any;
  backupRefused: any;
  bot: any;
  boundedCoordination: any;
  card: any;
  commsDepth: any;
  computerSkipped: any;
  continuingRoutine: any;
  coordinated: any;
  dispatchClaimId: any;
  effort: any;
  engine: any;
  guestConfined: any;
  instance: any;
  instanceId: any;
  levels: any;
  line: any;
  maySelectComputer: any;
  model: any;
  notice: any;
  onCall: any;
  onDispatchError: any;
  payer: any;
  peerHop: any;
  peerToolsMounted: any;
  person: any;
  personLine: any;
  placedText: any;
  plan: any;
  profile: any;
  providerText: any;
  recoveryUserMessageId: any;
  requestMessageId: any;
  resolvedImages: any;
  resourceOwner: any;
  selection: any;
  smallTalk: any;
  source: any;
  speaker: any;
  spoken: any;
  task: any;
  threadId: any;
  toolScope: any;
  trigger: any;
  turnAuto: any;
  turnImages: any;
  turnPlace: any;
  turnPrincipal: any;
  userMessage: any;
  variant: any;
  voiceCallText: any;
  voiceCallTurn: any;
  voiceTurnPick: any;
  warmOnly: any;

  // Try-scoped fields that stream post-dispatch / finish may read.
  warmOk: boolean;
  browser: any;
  browserCapture: any;
  contextOrder: any;
  contextReset: any;
  contextStillPending: any;
  cwd: any;
  dispatch: any;
  dispatchContext: any;
  externalContextMarker: any;
  origin: any;
  previewCapture: any;
  record: any;
  resource: any;
  rewound: any;
  voiceAnchor: any;
  voiceHanded: any;
  voiceView: any;
  integrations: any;
  compactPrompt: any;
  recalled: any;
  transcript: any;
  wants: any;
  placeSource: any;
  localVmTarget: any;
  connectorSwitch: any;
  runtime: any;
  enginesRead: any;
  plannedConfig: any;
  strictResume: any;
  privateWorkspace: any;
  providerTurnId: any;
};

export type PrepareResult =
  | { kind: "return"; value: any }
  | { kind: "continue" };

export function createTurnState(init: {
  botId: string;
  text: string;
  opts?: any;
  startTurn: StartTurnFn;
}): TurnState {
  return {
    botId: init.botId,
    text: init.text,
    opts: init.opts,
    startTurn: init.startTurn,

    agentsMounted: undefined,
    answer: undefined,
    autoBaseSelection: undefined,
    autoTurn: undefined,
    backupRefused: undefined,
    bot: undefined,
    boundedCoordination: undefined,
    card: undefined,
    commsDepth: undefined,
    computerSkipped: undefined,
    continuingRoutine: undefined,
    coordinated: undefined,
    dispatchClaimId: undefined,
    effort: undefined,
    engine: undefined,
    guestConfined: undefined,
    instance: undefined,
    instanceId: undefined,
    levels: undefined,
    line: undefined,
    maySelectComputer: undefined,
    model: undefined,
    notice: undefined,
    onCall: undefined,
    onDispatchError: undefined,
    payer: undefined,
    peerHop: undefined,
    peerToolsMounted: undefined,
    person: undefined,
    personLine: undefined,
    placedText: undefined,
    plan: undefined,
    profile: undefined,
    providerText: undefined,
    recoveryUserMessageId: undefined,
    requestMessageId: undefined,
    resolvedImages: undefined,
    resourceOwner: undefined,
    selection: undefined,
    smallTalk: undefined,
    source: undefined,
    speaker: undefined,
    spoken: undefined,
    task: undefined,
    threadId: undefined,
    toolScope: undefined,
    trigger: undefined,
    turnAuto: undefined,
    turnImages: undefined,
    turnPlace: undefined,
    turnPrincipal: undefined,
    userMessage: undefined,
    variant: undefined,
    voiceCallText: undefined,
    voiceCallTurn: undefined,
    voiceTurnPick: undefined,
    warmOnly: undefined,

    warmOk: false,
    browser: undefined,
    browserCapture: undefined,
    contextOrder: undefined,
    contextReset: undefined,
    contextStillPending: undefined,
    cwd: undefined,
    dispatch: undefined,
    dispatchContext: undefined,
    externalContextMarker: undefined,
    origin: undefined,
    previewCapture: undefined,
    record: undefined,
    resource: undefined,
    rewound: undefined,
    voiceAnchor: undefined,
    voiceHanded: undefined,
    voiceView: undefined,
    integrations: undefined,
    compactPrompt: undefined,
    recalled: undefined,
    transcript: undefined,
    wants: undefined,
    placeSource: undefined,
    localVmTarget: undefined,
    connectorSwitch: undefined,
    runtime: undefined,
    enginesRead: undefined,
    plannedConfig: undefined,
    strictResume: undefined,
    privateWorkspace: undefined,
    providerTurnId: undefined,
  };
}
