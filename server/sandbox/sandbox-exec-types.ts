
export interface SandboxExecInput {
  argv: string[];
  env?: Record<string, string>;
  /** Bytes for the command's stdin, in base64 (a large file body: one
   * variable or argument is limited to 128 KiB by Linux). The command reads
   * exactly that many bytes (`head -c N`): a Kubernetes exec cannot close
   * stdin, so a read to end of file would wait for the time limit there.
   * Without it the command's stdin is empty. */
  stdinBase64?: string;
  timeoutSec?: number;
  maxOutputBytes?: number;
}

export interface SandboxExecOutput {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}
