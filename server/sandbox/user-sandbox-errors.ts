// The error a person's server environment call ends with when it cannot run:
// a short message for the bot or the Computer tab, and a stable code.
export class UserSandboxUnavailable extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}
