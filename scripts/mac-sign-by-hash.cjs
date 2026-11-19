// electron-builder signs the app by identity *name*, which codesign rejects as
// ambiguous when the keychain holds two certificates with the same name (a
// renewed Developer ID). package-fork.mjs uses this hook when
// SAGAX_MAC_IDENTITY is a SHA-1 certificate hash, so codesign gets the hash.
const builder = require.resolve("electron-builder");
const { isNonCode } = require("./mac-sign-ignore.cjs");
const { sign } = require(require.resolve("app-builder-lib/out/codeSign/macCodeSign", { paths: [builder] }));

exports.default = async function signByHash(opts) {
  const hash = process.env.SAGAX_MAC_IDENTITY;
  if (!/^[0-9A-F]{40}$/i.test(hash ?? "")) throw new Error("SAGAX_MAC_IDENTITY must be a certificate SHA-1 hash here");
  // Sign code only: data files (.pak, .lproj contents, images, json) are sealed
  // by their bundle and each signature costs a timestamp round trip.
  const builderIgnore = [].concat(opts.ignore ?? []);
  const ignore = [...builderIgnore, (file) => isNonCode(file)];
  return sign({ ...opts, identity: hash, ignore });
};
