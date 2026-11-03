import type { Action, AppState, Bot, BotAnnouncement, Group, Message, OptionCardData, TaskUpdatePatch } from "./model";
import type { openOnboardingCard } from "./model";
import type { BotUpdatePatch } from "../bot-patch-queue";

export interface StoreDispatchCtx {
  stateRef: { current: AppState };
  rawDispatch: (action: Action) => void;
  botPatchQueue: {
    enqueue: (botId: string, patch: BotUpdatePatch, current: BotAnnouncement) => void;
    flush: (botId: string) => Promise<BotAnnouncement | null | undefined>;
    cancel: (botId: string) => void;
  };
  threadPages: {
    get: (threadId: string) => { messages: Message[]; hasMore?: boolean; activeLeafId?: string | null } | undefined;
    set: (threadId: string, page: { messages: Message[]; hasMore?: boolean; activeLeafId?: string | null; at: number }) => void;
    delete: (threadId: string) => void;
  };
  withTaskWrites: (bot: BotAnnouncement) => BotAnnouncement;
  showThreadsRef: { current: boolean };
  taskWrites: Map<string, { botId: string; updatesDefault: boolean; promise: Promise<BotAnnouncement>; execution: Promise<unknown>; patch: TaskUpdatePatch }>;
}

export type DispatchShared = {
  selectionRevision: number;
  creatingBot: boolean;
};

export type DispatchEnv = StoreDispatchCtx & {
  navigation: Map<string, number>;
  freshTopicsCreating: Map<string, Promise<string>>;
  shared: DispatchShared;
  olderPagesInFlight: Set<string>;
  showError: (e: unknown) => void;
  cardTarget: (action: { botId: string; messageId: string; groupId?: string }) => {
    host: (Bot | Group) | undefined;
    card: OptionCardData | undefined;
    inRoom: boolean;
  };
  persistCard: (botId: string, messageId: string, patch: Partial<OptionCardData>) => void;
  waitForExecutionSettings: (expectedBots: Bot[], threadId?: string) => Promise<void>;
  persistTaskPatch: (botId: string, threadId: string, patch: TaskUpdatePatch) => void;
  dispatch: (action: Action) => void;
  executionBotsBeforeAction: Bot[];
  quizBeforeSend: ReturnType<typeof openOnboardingCard> | undefined;
  freshSendBefore: boolean;
  botBeforeUpdate: Bot | undefined;
  botBeforeSend: Bot | undefined;
  leafBeforeEdit: string | null;
};
