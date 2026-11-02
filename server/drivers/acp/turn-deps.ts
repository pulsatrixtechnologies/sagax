import type { ModelCatalog, SendTurnInput } from "../../contracts.ts";
import type { AcpAskFinish, AcpConfig, AcpSession, AcpSupport, AcpTurn } from "./types.ts";

export type SendTurnDeps = {
  support: AcpSupport;
  DRIVER_KIND: string;
  config: AcpConfig;
  instanceId: string;
  childEnv: (activeConfig?: AcpConfig) => Record<string, string | undefined>;
  requireRunning: () => void;
  getStartupModelRefresh: () => Promise<void> | null;
  sessions: Map<string, AcpSession>;
  warming: Map<string, Promise<void>>;
  active: Map<string, { stop: () => void; interrupt: () => void; turnId: string; asks: Map<string, AcpAskFinish> }>;
  freshNextTurn: Set<string>;
  sessionAllows: Map<string, Set<string>>;
  threadNotices: Map<string, string>;
  retiring: Map<string, Set<any>>;
  retireChild: (threadId: string, child: any) => Promise<boolean>;
  openSession: (
    threadId: string,
    launch: { command: string; args?: string[] },
    argv: string[],
    env: Record<string, string | undefined>,
    cwd: string,
    contractKey: string,
  ) => AcpSession;
  closeSession: (threadId: string, why: string) => void;
  armIdle: (threadId: string) => void;
  settle: (threadId: string, session: AcpSession, ok: boolean, stopReason: string | null) => void;
  emit: (event: any) => void;
  base: (threadId: string, turnId: string) => Record<string, unknown>;
  acpMcpServers: (turn: SendTurnInput, approvalGated?: boolean) => any[];
  startQuietWatch: (threadId: string, session: AcpSession, current: AcpTurn) => { lastState: () => any };
  getModels: () => ModelCatalog;
  getAccountModels: () => ReadonlySet<string> | null;
  setAccountModels: (models: ReadonlySet<string> | null) => void;
  instanceEnvironment: Readonly<Record<string, string>>;
};
