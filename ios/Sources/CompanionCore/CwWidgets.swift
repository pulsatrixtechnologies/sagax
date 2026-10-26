// ConnectWise widgets on the phone. The JSON is the same data the web draws
// (`shared/cw-widgets`). A change is an approval request, never a write.
import Foundation

public struct CwNoteView: Codable, Hashable, Sendable {
    public var id: Int?
    public var text: String
    public var by: String?
    public var at: String?
    public var internalNote: Bool?
    public var resolution: Bool?

    enum CodingKeys: String, CodingKey {
        case id, text, by, at, resolution
        case internalNote = "internal"
    }
}

public struct CwRecordView: Codable, Hashable, Sendable {
    public var id: Int
    public var summary: String?
    public var name: String?
    public var status: String?
    public var priority: String?
    public var company: String?
    public var contact: String?
    public var board: String?
    public var owner: String?
    public var member: String?
    public var charge: String?
    public var workType: String?
    public var billable: String?
    public var hours: Double?
    public var actualHours: Double?
    public var budgetHours: Double?
    public var notes: String?
    public var ticketNotes: [CwNoteView]?
    public var start: String?
    public var end: String?
    public var due: String?
    public var updated: String?
    public var place: String?
    public var done: Bool?
    public var closed: Bool?
    public var cancelled: Bool?
    public var billAmount: Double?
    public var cycle: String?
    public var identifier: String?
    public var phone: String?
    public var website: String?
    public var city: String?
    public var agreement: String?
    public var link: String?

    enum CodingKeys: String, CodingKey {
        case id, summary, name, status, priority, company, contact, board, owner, member
        case charge, workType, billable, hours, actualHours, budgetHours, notes
        case start, end, due, updated, done, closed, cancelled, billAmount, cycle
        case identifier, phone, website, city, agreement, link
        case place = "where"
    }

    public init(from decoder: Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        id = try box.decode(Int.self, forKey: .id)
        summary = try box.decodeIfPresent(String.self, forKey: .summary)
        name = try box.decodeIfPresent(String.self, forKey: .name)
        status = try box.decodeIfPresent(String.self, forKey: .status)
        priority = try box.decodeIfPresent(String.self, forKey: .priority)
        company = try box.decodeIfPresent(String.self, forKey: .company)
        contact = try box.decodeIfPresent(String.self, forKey: .contact)
        board = try box.decodeIfPresent(String.self, forKey: .board)
        owner = try box.decodeIfPresent(String.self, forKey: .owner)
        member = try box.decodeIfPresent(String.self, forKey: .member)
        charge = try box.decodeIfPresent(String.self, forKey: .charge)
        workType = try box.decodeIfPresent(String.self, forKey: .workType)
        billable = try box.decodeIfPresent(String.self, forKey: .billable)
        hours = try box.decodeIfPresent(Double.self, forKey: .hours)
        actualHours = try box.decodeIfPresent(Double.self, forKey: .actualHours)
        budgetHours = try box.decodeIfPresent(Double.self, forKey: .budgetHours)
        start = try box.decodeIfPresent(String.self, forKey: .start)
        end = try box.decodeIfPresent(String.self, forKey: .end)
        due = try box.decodeIfPresent(String.self, forKey: .due)
        updated = try box.decodeIfPresent(String.self, forKey: .updated)
        place = try box.decodeIfPresent(String.self, forKey: .place)
        done = try box.decodeIfPresent(Bool.self, forKey: .done)
        closed = try box.decodeIfPresent(Bool.self, forKey: .closed)
        cancelled = try box.decodeIfPresent(Bool.self, forKey: .cancelled)
        billAmount = try box.decodeIfPresent(Double.self, forKey: .billAmount)
        cycle = try box.decodeIfPresent(String.self, forKey: .cycle)
        identifier = try box.decodeIfPresent(String.self, forKey: .identifier)
        phone = try box.decodeIfPresent(String.self, forKey: .phone)
        website = CwWidgets.httpsURL(try box.decodeIfPresent(String.self, forKey: .website))
        city = try box.decodeIfPresent(String.self, forKey: .city)
        agreement = try box.decodeIfPresent(String.self, forKey: .agreement)
        link = CwWidgets.recordLink(try box.decodeIfPresent(String.self, forKey: .link))
        notes = nil
        ticketNotes = nil
        if let text = try? box.decode(String.self, forKey: .notes) {
            notes = text
        } else if let list = try? box.decode([CwNoteView].self, forKey: .notes) {
            ticketNotes = list
        }
    }

    public func encode(to encoder: Encoder) throws {
        var box = encoder.container(keyedBy: CodingKeys.self)
        try box.encode(id, forKey: .id)
        try box.encodeIfPresent(summary, forKey: .summary)
        try box.encodeIfPresent(name, forKey: .name)
        try box.encodeIfPresent(status, forKey: .status)
        try box.encodeIfPresent(priority, forKey: .priority)
        try box.encodeIfPresent(company, forKey: .company)
        try box.encodeIfPresent(contact, forKey: .contact)
        try box.encodeIfPresent(board, forKey: .board)
        try box.encodeIfPresent(owner, forKey: .owner)
        try box.encodeIfPresent(member, forKey: .member)
        try box.encodeIfPresent(charge, forKey: .charge)
        try box.encodeIfPresent(workType, forKey: .workType)
        try box.encodeIfPresent(billable, forKey: .billable)
        try box.encodeIfPresent(hours, forKey: .hours)
        try box.encodeIfPresent(actualHours, forKey: .actualHours)
        try box.encodeIfPresent(budgetHours, forKey: .budgetHours)
        try box.encodeIfPresent(start, forKey: .start)
        try box.encodeIfPresent(end, forKey: .end)
        try box.encodeIfPresent(due, forKey: .due)
        try box.encodeIfPresent(updated, forKey: .updated)
        try box.encodeIfPresent(place, forKey: .place)
        try box.encodeIfPresent(done, forKey: .done)
        try box.encodeIfPresent(closed, forKey: .closed)
        try box.encodeIfPresent(cancelled, forKey: .cancelled)
        try box.encodeIfPresent(billAmount, forKey: .billAmount)
        try box.encodeIfPresent(cycle, forKey: .cycle)
        try box.encodeIfPresent(identifier, forKey: .identifier)
        try box.encodeIfPresent(phone, forKey: .phone)
        try box.encodeIfPresent(website, forKey: .website)
        try box.encodeIfPresent(city, forKey: .city)
        try box.encodeIfPresent(agreement, forKey: .agreement)
        try box.encodeIfPresent(link, forKey: .link)
        if let ticketNotes { try box.encode(ticketNotes, forKey: .notes) }
        else { try box.encodeIfPresent(notes, forKey: .notes) }
    }
}

public struct CwWidget: Codable, Hashable, Sendable {
    public var family: String
    public var view: String
    public var total: Int?
    public var records: [CwRecordView]

    public var isKnown: Bool {
        ["ticket", "time", "schedule", "agreement", "company"].contains(family) && !records.isEmpty
    }

    public static func parse(_ source: String) -> CwWidget? {
        guard source.count <= 1_000_000, let data = source.data(using: .utf8) else { return nil }
        guard let widget = try? JSONDecoder().decode(CwWidget.self, from: data), widget.isKnown else { return nil }
        return widget
    }
}

public struct CwActionBody: Codable, Hashable, Sendable {
    public var kind: String
    public var ticketId: Int?
    public var status: String?
    public var from: String?
    public var text: String?
    public var internalFlag: Bool?
    public var entryId: Int?
    public var billable: String?
    public var done: Bool?
    public var companyId: Int?

    enum CodingKeys: String, CodingKey {
        case kind, ticketId, status, from, text, entryId, billable, done, companyId
        case internalFlag = "internal"
    }

    public static func ticketStatus(ticketId: Int, status: String, from: String?) -> CwActionBody {
        CwActionBody(kind: "ticket.status", ticketId: ticketId, status: status, from: from, text: nil, internalFlag: nil, entryId: nil, billable: nil, done: nil, companyId: nil)
    }

    public static func ticketNote(ticketId: Int, text: String, internalNote: Bool) -> CwActionBody {
        CwActionBody(kind: "ticket.note", ticketId: ticketId, status: nil, from: nil, text: text, internalFlag: internalNote, entryId: nil, billable: nil, done: nil, companyId: nil)
    }

    public static func timeBillable(entryId: Int, billable: String, from: String?) -> CwActionBody {
        CwActionBody(kind: "time.billable", ticketId: nil, status: nil, from: from, text: nil, internalFlag: nil, entryId: entryId, billable: billable, done: nil, companyId: nil)
    }

    public static func scheduleDone(entryId: Int, done: Bool) -> CwActionBody {
        CwActionBody(kind: "schedule.done", ticketId: nil, status: nil, from: nil, text: nil, internalFlag: nil, entryId: entryId, billable: nil, done: done, companyId: nil)
    }

    public static func companyNote(companyId: Int, text: String) -> CwActionBody {
        CwActionBody(kind: "company.note", ticketId: nil, status: nil, from: nil, text: text, internalFlag: nil, entryId: nil, billable: nil, done: nil, companyId: companyId)
    }
}

public struct CwActionReceipt: Decodable, Sendable {
    public var requestId: String?
    public var messageId: String?
}

public enum CwWidgets {
    /// A Perspicax view tool (`cw_psa__show_<view>`), the one ConnectWise call
    /// whose tool row draws its widget (shared/cw-widgets/tool-call.ts
    /// `isCwViewTool`). Rows stored before 2026-10-20 carry a widget on every
    /// read; they stay ordinary rows.
    public static func isViewTool(_ name: String?) -> Bool {
        guard let name = name?.lowercased() else { return false }
        return name.range(of: "(^|_)cw_psa_+show_", options: .regularExpression) != nil
    }

    /// The Manage record router, https only. Anything else is not opened. */
    public static func recordLink(_ value: String?) -> String? {
        guard let value, value.count <= 600, let url = URL(string: value), url.scheme == "https",
              url.path == "/v4_6_release/services/system_io/router/openrecord.rails"
        else { return nil }
        return url.absoluteString
    }

    /// A company site, https only, with no user name. */
    public static func httpsURL(_ value: String?) -> String? {
        guard let value, value.count <= 300, let url = URL(string: value), url.scheme == "https",
              url.user == nil, url.password == nil, let host = url.host, !host.isEmpty
        else { return nil }
        return url.absoluteString
    }
}
