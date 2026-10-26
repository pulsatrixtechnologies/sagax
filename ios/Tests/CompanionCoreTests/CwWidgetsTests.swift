import XCTest
import CompanionCore

final class CwWidgetsTests: XCTestCase {
    func testOnlyAViewToolDrawsItsWidget() {
        XCTAssertTrue(CwWidgets.isViewTool("mcp__perspicax_x__cw_psa__show_schedule"))
        XCTAssertTrue(CwWidgets.isViewTool("cw_psa__show_tickets"))
        XCTAssertFalse(CwWidgets.isViewTool("mcp__perspicax_x__cw_psa__find_schedule_entries"))
        XCTAssertFalse(CwWidgets.isViewTool("cw_psa__query"))
        XCTAssertFalse(CwWidgets.isViewTool("show_widget"))
        XCTAssertFalse(CwWidgets.isViewTool(nil))
    }

    func testParsesATicketAndDropsAForeignLink() throws {
        let source = """
        {"family":"ticket","view":"card","records":[{"id":48213,"summary":"Imprimante","status":"En cours","link":"https://evil.example/steal","notes":[{"text":"Bonjour","internal":true}]}]}
        """
        let widget = try XCTUnwrap(CwWidget.parse(source))
        XCTAssertEqual(widget.family, "ticket")
        XCTAssertEqual(widget.records.first?.summary, "Imprimante")
        XCTAssertNil(widget.records.first?.link)
        XCTAssertEqual(widget.records.first?.ticketNotes?.first?.internalNote, true)
        XCTAssertNil(CwWidget.parse("{\"family\":\"nope\",\"records\":[{\"id\":1}]}"))
    }

    func testAWidgetRowIsNotHiddenWithTheToolChips() throws {
        let data = """
        {"id":"w","role":"bot","kind":"activity","at":1,"tool":{"name":"cw_psa__query","ok":true,"widget":{"family":"time","view":"card","records":[{"id":88021,"charge":"Ticket #48213","hours":1.25}]}}}
        """.data(using: .utf8)!
        let message = try JSONDecoder().decode(Message.self, from: data)
        XCTAssertEqual(message.tool?.widget?.family, "time")
        XCTAssertFalse(isToolActivityRow(message))
        let rows = transcriptRows([message], detail: .hidden)
        XCTAssertEqual(rows.map(\.id), ["w"])
    }

    func testABrokenWidgetDoesNotDropTheActivity() throws {
        let data = """
        {"id":"w","role":"bot","kind":"activity","at":1,"tool":{"name":"cw_psa__query","ok":true,"widget":{"family":1}}}
        """.data(using: .utf8)!
        let message = try JSONDecoder().decode(Message.self, from: data)
        XCTAssertEqual(message.tool?.name, "cw_psa__query")
        XCTAssertNil(message.tool?.widget)
    }

    func testActionJSONNamesTheApprovalRouteShape() throws {
        let action = CwActionBody.companyNote(companyId: 250, text: "Appelé.")
        let data = try JSONEncoder().encode(action)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(object?["kind"] as? String, "company.note")
        XCTAssertEqual(object?["companyId"] as? Int, 250)
        XCTAssertNil(object?["ticketId"])
    }
}
