// A leaf on purpose (#1381 madge ratchet): engine-credentials.ts reads it,
// and principal-engine-logins.ts reaches the Grok driver, which reaches
// config.ts back through the usage ledger. The rule itself lives in
// shared/added-account.ts (#4415: the Providers page reads it too).
export { separateAccountInstance } from "../../shared/added-account.ts";
