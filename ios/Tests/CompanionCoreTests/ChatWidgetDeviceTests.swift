import Foundation
import XCTest
@testable import CompanionCore

/// Decoding and routing for in-app widget actions (open_page, open_routine,
/// open_run): shared/widget.ts `widgetAppAction` and the desktop's
/// widget-device.ts, on the phone.
final class ChatWidgetDeviceTests: XCTestCase {
    func testDecodesOpenPageActions() {
        XCTAssertEqual(
            ChatWidgetDevice.appAction(type: "open_page", payload: .object(["page": .string("routines")])),
            .openPage(.routines)
        )
        XCTAssertEqual(
            ChatWidgetDevice.appAction(type: "open_page", payload: .object(["page": .string("approvals")])),
            .openPage(.approvals)
        )
        XCTAssertEqual(
            ChatWidgetDevice.appAction(type: "open_page", payload: .object(["page": .string("team_map")])),
            .openPage(.teamMap)
        )
        XCTAssertEqual(
            ChatWidgetDevice.appAction(type: "open_page", payload: .object(["page": .string("achievements")])),
            .openPage(.achievements)
        )
        XCTAssertEqual(
            ChatWidgetDevice.appAction(type: "open_page", payload: .object(["page": .string("code")])),
            .openPage(.code)
        )
        XCTAssertEqual(
            ChatWidgetDevice.appAction(type: "open_page", payload: .object(["page": .string("remote_sessions")])),
            .openPage(.remoteSessions)
        )
        XCTAssertNil(ChatWidgetDevice.appAction(type: "open_page", payload: .object(["page": .string("billing")])))
        XCTAssertNil(ChatWidgetDevice.appAction(type: "open_page", payload: .object([:])))
    }

    func testDecodesOpenRoutineAndOpenRun() {
        XCTAssertEqual(
            ChatWidgetDevice.appAction(type: "open_routine", payload: .object([
                "routineId": .string("r-1"), "botId": .string("bot-a"),
            ])),
            .openRoutine(routineId: "r-1", botId: "bot-a")
        )
        XCTAssertEqual(
            ChatWidgetDevice.appAction(type: "open_routine", payload: .object(["routineId": .string("r-1")])),
            .openRoutine(routineId: "r-1", botId: nil)
        )
        XCTAssertNil(ChatWidgetDevice.appAction(type: "open_routine", payload: .object([:])))
        XCTAssertNil(ChatWidgetDevice.appAction(type: "open_routine", payload: .object(["routineId": .string("bad id")])))

        XCTAssertEqual(
            ChatWidgetDevice.appAction(type: "open_run", payload: .object([
                "runId": .string("run-1"), "routineId": .string("r-1"),
            ])),
            .openRun(runId: "run-1", routineId: "r-1")
        )
        XCTAssertEqual(
            ChatWidgetDevice.appAction(type: "open_run", payload: .object(["runId": .string("run-1")])),
            .openRun(runId: "run-1", routineId: nil)
        )
        XCTAssertNil(ChatWidgetDevice.appAction(type: "open_run", payload: .object([:])))
    }

    func testActionsMarkInAppPlacesAsClient() throws {
        let json = """
        {"type":"Card","id":"n1","children":[
          {"type":"Button","id":"n2","label":"Open the routine board","onClickAction":{"type":"open_page","payload":{"page":"routines"}}},
          {"type":"Button","id":"n3","label":"Open last run","onClickAction":{"type":"open_run","payload":{"runId":"run-1","routineId":"r-1"}}},
          {"type":"Button","id":"n4","label":"Open docs","onClickAction":{"type":"open_url","payload":{"url":"https://example.com"}}},
          {"type":"Button","id":"n5","label":"Pause all","onClickAction":{"type":"routines.pause"}}
        ]}
        """
        let root = try XCTUnwrap(ChatWidgetNode(json: try JSONDecoder().decode(WidgetJSON.self, from: Data(json.utf8))))
        let actions = ChatWidgetRules.actions(root)
        XCTAssertEqual(actions.map(\.ref), ["n2", "n3", "n4", "n5"])
        XCTAssertEqual(actions[0].appAction, .openPage(.routines))
        XCTAssertEqual(actions[1].appAction, .openRun(runId: "run-1", routineId: "r-1"))
        XCTAssertNil(actions[2].appAction)
        XCTAssertEqual(actions[2].url?.absoluteString, "https://example.com")
        XCTAssertNil(actions[3].appAction)
        XCTAssertTrue(actions[0].client)
        XCTAssertTrue(actions[1].client)
        XCTAssertTrue(actions[2].client)
        XCTAssertFalse(actions[3].client)
    }

    func testRoutesToClosestIPhoneDestinations() {
        XCTAssertEqual(
            ChatWidgetDevice.destination(for: .openPage(.routines), botId: "scout"),
            .automations
        )
        XCTAssertEqual(
            ChatWidgetDevice.destination(for: .openPage(.approvals), botId: "scout"),
            .updates
        )
        XCTAssertEqual(
            ChatWidgetDevice.destination(for: .openPage(.teamMap), botId: "scout"),
            .teamMap
        )
        XCTAssertEqual(
            ChatWidgetDevice.destination(for: .openPage(.achievements), botId: "scout"),
            .achievements
        )
        // Code and remote sessions have no phone twin: Computer is closest.
        XCTAssertEqual(
            ChatWidgetDevice.destination(for: .openPage(.code), botId: "scout"),
            .botComputer(botId: "scout")
        )
        XCTAssertEqual(
            ChatWidgetDevice.destination(for: .openPage(.remoteSessions), botId: "scout"),
            .botComputer(botId: "scout")
        )
        XCTAssertEqual(
            ChatWidgetDevice.destination(for: .openRoutine(routineId: "r-1", botId: nil), botId: "scout"),
            .routine(routineId: "r-1", botId: "scout")
        )
        XCTAssertEqual(
            ChatWidgetDevice.destination(for: .openRoutine(routineId: "r-1", botId: "other"), botId: "scout"),
            .routine(routineId: "r-1", botId: "other")
        )
        XCTAssertEqual(
            ChatWidgetDevice.destination(for: .openRun(runId: "run-1", routineId: "r-1"), botId: "scout"),
            .run(runId: "run-1", routineId: "r-1")
        )
    }

    func testOpenURLStillClientOnlyAndNeverAnAppAction() throws {
        let json = """
        {"type":"Card","id":"n1","children":[
          {"type":"Button","id":"n2","label":"Open","onClickAction":{"type":"open_url","payload":{"url":"https://example.com/a"}}}
        ]}
        """
        let root = try XCTUnwrap(ChatWidgetNode(json: try JSONDecoder().decode(WidgetJSON.self, from: Data(json.utf8))))
        let entry = try XCTUnwrap(ChatWidgetRules.actions(root).first)
        XCTAssertTrue(entry.client)
        XCTAssertNil(entry.appAction)
        XCTAssertEqual(entry.url?.absoluteString, "https://example.com/a")
    }
}
