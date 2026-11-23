// Shared macOS sign plan: which identity string codesign receives, and which
// files it skips. Identity selection stays with electron-builder. This module
// only turns the hash electron-builder already resolved back into that
// certificate's name (the string its built-in signer passes), and adds the
// code-only ignore. No keychain, certificate or notarization setting is read
// here except the find-identity text a caller supplies.
const { isNonCode } = require("./mac-sign-ignore.cjs");

function codeOnlyIgnore(existing) {
  return [...[].concat(existing ?? []), (file) => isNonCode(file)];
}

function codeOnlySignOptions(opts, identity) {
  return { ...opts, identity, ignore: codeOnlyIgnore(opts.ignore) };
}

// `security find-identity -v` lines: `  1) <40 hex> "<certificate name>"`.
function certificateNameFromFindIdentity(output, hash) {
  const needle = String(hash).toUpperCase();
  if (!/^[0-9A-F]{40}$/.test(needle)) return null;
  for (const line of String(output).split("\n")) {
    const match = line.match(/([0-9A-Fa-f]{40})\s+"([^"]+)"/);
    if (match && match[1].toUpperCase() === needle) return match[2];
  }
  return null;
}

// A name, "-", or any non-hash identity is returned unchanged. A 40-hex hash
// is the certificate electron-builder already chose: map it back to that
// certificate's name so codesign receives the same string as the built-in
// signer. If the name cannot be read, the hash is kept (the same certificate).
function signIdentity(opts, readFindIdentity) {
  const current = opts.identity;
  if (typeof current !== "string" || !/^[0-9A-F]{40}$/i.test(current)) return current;
  let output;
  try {
    output = readFindIdentity(opts.keychain);
  } catch {
    return current;
  }
  return certificateNameFromFindIdentity(output, current) ?? current;
}

function hashSignOptions(opts, envValue) {
  if (!/^[0-9A-F]{40}$/i.test(envValue ?? "")) {
    throw new Error("SAGAX_MAC_IDENTITY must be a certificate SHA-1 hash here");
  }
  return codeOnlySignOptions(opts, envValue);
}

module.exports = {
  certificateNameFromFindIdentity,
  codeOnlyIgnore,
  codeOnlySignOptions,
  hashSignOptions,
  signIdentity,
};
