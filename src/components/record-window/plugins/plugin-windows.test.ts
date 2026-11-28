// Which record opens which window of another plugin (M-20261127-141,
// M-20261127-146): by its product's catalog (alone or after an instance's
// prefix) and its kind; a folder of any plugin looks like the Finder.
import { describe, expect, it } from "vitest";
import { pluginWindowOf } from "./plugin-windows";

describe("pluginWindowOf", () => {
  it("opens each plugin's record in its own window", () => {
    expect(pluginWindowOf({ product: "acme_guard", kind: "threat" })).toBe("threat");
    expect(pluginWindowOf({ product: "axcient_x360recover", kind: "device" })).toBe("backup");
    expect(pluginWindowOf({ product: "bookstack", kind: "page" })).toBe("page");
    expect(pluginWindowOf({ product: "twilio_api", kind: "message" })).toBe("conversation");
    expect(pluginWindowOf({ product: "x_api", kind: "post" })).toBe("post");
    expect(pluginWindowOf({ product: "files", kind: "folder" })).toBe("folder");
  });

  it("reads a second instance's product by its catalog", () => {
    expect(pluginWindowOf({ product: "nimbus_acme_guard", kind: "threat" })).toBe("threat");
    expect(pluginWindowOf({ product: "acme_twilio_api", kind: "message" })).toBe("conversation");
  });

  it("leaves every other record to the card's facts", () => {
    expect(pluginWindowOf({ product: "acme_guard", kind: "agent" })).toBeUndefined();
    expect(pluginWindowOf({ product: "cw_rmm", kind: "device" })).toBeUndefined();
    expect(pluginWindowOf({ product: "nimbus_desk", kind: "ticket" })).toBeUndefined();
    expect(pluginWindowOf({ product: "twilio_monitor", kind: "message" })).toBeUndefined();
    expect(pluginWindowOf({ product: "notacme_guard", kind: "threat" })).toBeUndefined();
  });

  it("opens a folder of any plugin like the Finder", () => {
    expect(pluginWindowOf({ product: "nimbus_drive", kind: "folder" })).toBe("folder");
  });
});
