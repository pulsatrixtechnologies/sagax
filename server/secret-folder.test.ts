import { describe, expect, it } from "vitest";

import { inSecretFolder, SECRET_FOLDER, SECRET_FILE_REFUSAL } from "./secret-folder.ts";

describe("inSecretFolder", () => {
  it("recognizes Sagax and legacy OpenMausBot private secret folders", () => {
    expect(inSecretFolder(`/data/workspaces/atlas/${SECRET_FOLDER}/thread-1/card-1`)).toBe(true);
    expect(inSecretFolder(`workspaces/atlas/${SECRET_FOLDER}/t/c`)).toBe(true);
    expect(inSecretFolder("workspaces/atlas/.openmausbot-secrets/t/c")).toBe(true);
    expect(inSecretFolder("workspaces/atlas/notes.txt")).toBe(false);
    expect(SECRET_FILE_REFUSAL).toMatch(/secret the person gave/);
  });
});
