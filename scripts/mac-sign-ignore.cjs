// Which files of the .app codesign must touch. @electron/osx-sign signs every
// file isbinaryfile calls binary, and that includes data files such as each
// Electron locale .pak: one Apple timestamp round trip per file made a mac
// build take over an hour. Only code is signed: Mach-O files (by magic, never
// by extension), plus the .app and .framework bundles themselves.
const fs = require("node:fs");

// MH_MAGIC, MH_MAGIC_64, FAT_MAGIC, FAT_MAGIC_64 and their byte-swapped forms.
const MACHO_MAGICS = new Set([0xfeedface, 0xfeedfacf, 0xcafebabe, 0xcafebabf, 0xcefaedfe, 0xcffaedfe, 0xbebafeca, 0xbfbafeca]);

function isMachO(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const head = Buffer.alloc(4);
    if (fs.readSync(fd, head, 0, 4, 0) < 4) return false;
    return MACHO_MAGICS.has(head.readUInt32BE(0));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// true = leave the path unsigned. Directories (.app, .framework) are kept.
function isNonCode(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  return !isMachO(file);
}

module.exports = { isMachO, isNonCode };
