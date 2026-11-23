// electron-builder signs the app by identity *name*, which codesign rejects as
// ambiguous when the keychain holds two certificates with the same name (a
// renewed Developer ID). package-fork.mjs uses this hook when
// SAGAX_MAC_IDENTITY is a SHA-1 certificate hash, so codesign gets the hash.
const builder = require.resolve("electron-builder");
const { hashSignOptions } = require("./mac-sign-plan.cjs");
const { sign } = require(require.resolve("app-builder-lib/out/codeSign/macCodeSign", { paths: [builder] }));

exports.default = async function signByHash(opts) {
  // Sign code only: data files (.pak, .lproj contents, images, json) are sealed
  // by their bundle and each signature costs a timestamp round trip.
  return sign(hashSignOptions(opts, process.env.SAGAX_MAC_IDENTITY));
};
