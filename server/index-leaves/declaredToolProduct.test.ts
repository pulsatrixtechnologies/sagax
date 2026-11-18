import { describe, expect, it } from "vitest";
import { createDeclaredToolProduct, macAppProduct } from "./declaredToolProduct.ts";

// 2026-11-17: a Mail call of the Messages server read "Could not use Messages".
describe("declaredToolProduct: the Apple apps", () => {
  it("names each Apple app tool by its own app, whatever engine prefix it carries", () => {
    const declared = createDeclaredToolProduct(() => ({}));
    expect(declared("bot-1", "mcp__messages__mac_mail_list_mailboxes")).toEqual({ product: "Mail", productId: "mac_mail" });
    expect(declared(undefined, "messages__mac_calendar_list")).toEqual({ product: "Calendar", productId: "mac_calendar" });
    expect(declared("bot-1", "mcp__messages__mac_contacts_search")?.product).toBe("Contacts");
    expect(declared("bot-1", "mcp__messages__mac_reminders_complete")?.product).toBe("Reminders");
    expect(declared("bot-1", "mcp__messages__mac_notes_search")?.product).toBe("Notes");
    expect(declared("bot-1", "mcp__messages__mac_messages_send")?.product).toBe("Messages");
    expect(declared("bot-1", "mcp__messages__mac_photos_export")).toEqual({ product: "Photos", productId: "mac_photos" });
    expect(declared("bot-1", "mcp", JSON.stringify({ tool: "mac_mail_search" }))?.product).toBe("Mail");
  });

  it("leaves any other tool to Perspicax's declaration", () => {
    expect(macAppProduct("mac_shell")).toBeUndefined();
    const declared = createDeclaredToolProduct(() => ({ perspicaxMcp: { apiName: (_bot: string, id: string) => (id === "acme_desk" ? "Acme Desk" : undefined) } }));
    expect(declared("bot-1", "mcp__perspicax__acme_desk__query")).toEqual({ product: "Acme Desk", productId: "acme_desk" });
    expect(declared("bot-1", "mcp__sagax-environment__read_file")).toBeUndefined();
  });
});
