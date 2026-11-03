// Types for electron/local-vm-computer.mjs. The server typecheck imports that
// module from the drift test and cannot load a plain .mjs. The rules themselves
// stay in the .mjs and in server/computer/local-vm-computer.ts.
export declare const LOCAL_VM_COMPUTER_ARGUMENTS: Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export interface LocalVmComputerTool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
}

export declare function localVmComputerCatalog(): LocalVmComputerTool[];
export declare function localVmComputerCatalogText(): string;

export type LocalVmComputerCall =
  | { tool: string; arguments: Record<string, unknown>; image: boolean }
  | { error: string };

export declare function localVmComputerCall(name: unknown, input: unknown): LocalVmComputerCall;
