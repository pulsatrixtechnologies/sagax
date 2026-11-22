import Foundation
import XCTest
@testable import CompanionCore

/// A bot writes the widget tree; the phone lays it out on its main thread,
/// whose stack is 1 MB. A tree nested past `ChatWidgetNode.maxDepth` is drawn
/// at that depth with every leaf kept (#5159).
final class ChatWidgetDepthTests: XCTestCase {
    /// `levels` nested columns around one text and one button.
    private func chain(_ levels: Int) -> ChatWidgetNode {
        var node = ChatWidgetNode(type: "Col", id: "n\(levels)", children: [
            ChatWidgetNode(type: "Text", id: "text", props: ["value": .string("Deep")]),
            ChatWidgetNode(type: "Button", id: "button", props: ["label": .string("Go")]),
        ])
        for level in stride(from: levels - 1, through: 1, by: -1) {
            node = ChatWidgetNode(type: "Col", id: "n\(level)", children: [node])
        }
        return node
    }

    func testADeepTreeIsDrawnAtTheMaximumDepthWithEveryLeaf() {
        let deep = chain(60)
        XCTAssertEqual(deep.depth, 61)
        let capped = deep.cappedDepth()
        XCTAssertEqual(capped.depth, ChatWidgetNode.maxDepth)
        XCTAssertEqual(capped.leaves().map(\.id), ["text", "button"], "every word and control stays, in order")
    }

    func testAShallowTreeIsLeftAlone() {
        let tree = chain(4)
        XCTAssertEqual(tree.cappedDepth(), tree)
    }

    func testEveryPathIntoAPayloadIsCapped() throws {
        XCTAssertEqual(ChatWidgetPayload(root: chain(40)).root?.depth, ChatWidgetNode.maxDepth)
        var json = #"{"type":"Text","id":"leaf","value":"Deep"}"#
        for level in 0..<40 { json = #"{"type":"Col","id":"c\#(level)","children":[\#(json)]}"# }
        let payload = try JSONDecoder().decode(ChatWidgetPayload.self, from: Data(#"{"v":1,"rev":0,"root":\#(json)}"#.utf8))
        XCTAssertEqual(payload.root?.depth, ChatWidgetNode.maxDepth)
        XCTAssertEqual(payload.root?.leaves().map(\.id), ["leaf"])
    }

    /// The server's sample cards (widget-messages.json) are drawn unchanged.
    func testTheServersSampleCardsAreUnderTheCap() throws {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: "widget-messages", withExtension: "json", subdirectory: "Fixtures")
                ?? Bundle.module.url(forResource: "widget-messages", withExtension: "json")
        )
        let rows = try JSONDecoder().decode(ThreadPage.self, from: Data(contentsOf: url)).messages
        let roots = rows.compactMap { $0.widget?.root }
        XCTAssertFalse(roots.isEmpty)
        for root in roots { XCTAssertLessThanOrEqual(root.depth, 5, root.id) }
    }
}
