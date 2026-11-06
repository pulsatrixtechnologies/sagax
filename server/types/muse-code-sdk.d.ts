declare module "@muse-code/sdk" {
  export class MspError extends Error {
    code?: string;
  }

  export type MuseConnection = {
    request(method: string, params?: unknown): Promise<unknown>;
    command(method: string, params?: unknown, id?: string | { commandId: string }): Promise<unknown>;
    mintCommandId(): string;
    onServerRequest(handler: (request: { method: string; params?: unknown }) => Promise<unknown> | unknown): void;
    onNotification(handler: (notification: { method: string; params?: unknown }) => void): void;
    onProtocolError(handler: (error: unknown) => void): void;
    close(): void | Promise<void>;
    [key: string]: unknown;
  };

  export type SpawnedMsp = {
    connection: MuseConnection;
    initializeResult: unknown;
    exited: Promise<unknown>;
    close(): Promise<void>;
    initialize(options: Record<string, unknown>): Promise<SpawnedMsp>;
  };

  export type Connection = MuseConnection;

  export function spawnMspConnection(options: Record<string, unknown>): SpawnedMsp;
}
