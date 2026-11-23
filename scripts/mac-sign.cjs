// electron-builder mac sign hook for every build that does not pass a
// certificate hash. Signs the same identity the built-in signer would
// (certificate name, not a newly chosen one) and skips data files.
const { execFileSync } = require("node:child_process");
const builder = require.resolve("electron-builder");
const { codeOnlySignOptions, signIdentity } = require("./mac-sign-plan.cjs");
const { sign } = require(require.resolve("app-builder-lib/out/codeSign/macCodeSign", { paths: [builder] }));

function readFindIdentity(keychain) {
  const args = ["find-identity", "-v", "-p", "codesigning"];
  if (keychain) args.push(keychain);
  return execFileSync("/usr/bin/security", args, { encoding: "utf8", timeout: 10_000 });
}

exports.default = async function signCodeOnly(opts) {
  return sign(codeOnlySignOptions(opts, signIdentity(opts, readFindIdentity)));
};
