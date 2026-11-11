import Foundation
import XCTest
@testable import CompanionCore

/// What enters a bot's main chat (#3581): the server's and the desktop's
/// cases (shared/chat-relevance.vectors.json), run here too.
final class ChatRelevanceTests: XCTestCase {
    private func vectors() throws -> [String: Any] {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("shared/chat-relevance.vectors.json")
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    func testPlaceVectors() throws {
        let cases = try XCTUnwrap(vectors()["place"] as? [[String: Any]])
        XCTAssertGreaterThan(cases.count, 15)
        var named = Set<String>()
        for item in cases {
            let name = try XCTUnwrap(item["name"] as? String)
            let origin = try XCTUnwrap(ChatRelevance.Origin(rawValue: XCTUnwrap(item["origin"] as? String)), name)
            let signal = try XCTUnwrap(ChatRelevance.Signal(rawValue: XCTUnwrap(item["signal"] as? String)), name)
            let raw = item["facts"] as? [String: Any] ?? [:]
            let facts = ChatRelevance.Facts(
                answersPerson: raw["answersPerson"] as? Bool ?? false,
                postsResults: raw["postsResults"] as? Bool ?? false,
                startedByPerson: raw["startedByPerson"] as? Bool ?? false
            )
            XCTAssertEqual(ChatRelevance.place(origin, signal, facts).rawValue, item["place"] as? String, name)
            named.insert("\(origin.rawValue)/\(signal.rawValue)")
        }
        // the cases name every origin with every signal
        for origin in ChatRelevance.Origin.allCases {
            for signal in ChatRelevance.Signal.allCases {
                XCTAssertTrue(named.contains("\(origin.rawValue)/\(signal.rawValue)"), "\(origin)/\(signal)")
                // work never reaches the main chat as content
                if signal == .work { XCTAssertTrue([.folded, .trace, .out].contains(ChatRelevance.place(origin, .work))) }
            }
        }
    }

    func testOriginVectors() throws {
        let cases = try XCTUnwrap(vectors()["origin"] as? [[String: Any]])
        XCTAssertGreaterThan(cases.count, 6)
        for item in cases {
            let name = try XCTUnwrap(item["name"] as? String)
            var fields = try XCTUnwrap(item["task"] as? [String: Any])
            fields["threadId"] = "t"
            fields["title"] = ""
            fields["createdAt"] = 1
            if var opener = fields["openedBy"] as? [String: Any] {
                opener["name"] = opener["name"] ?? ""
                opener["at"] = opener["at"] ?? 1
                fields["openedBy"] = opener
            }
            let task = try JSONDecoder().decode(BotTask.self, from: JSONSerialization.data(withJSONObject: fields))
            let expected = item["origin"] as? String
            XCTAssertEqual(ChatRelevance.origin(task).rawValue, expected, name)
        }
        XCTAssertEqual(ChatRelevance.origin(nil), .person)
    }

    func testSignalVectors() throws {
        let cases = try XCTUnwrap(vectors()["signal"] as? [[String: Any]])
        XCTAssertGreaterThan(cases.count, 10)
        for item in cases {
            let name = try XCTUnwrap(item["name"] as? String)
            let run = try XCTUnwrap(item["run"] as? [String: Any])
            let facts = ChatRelevance.RunFacts(
                status: run["status"] as? String ?? "",
                goalStatus: run["goalStatus"] as? String,
                quiet: run["quiet"] as? Bool ?? false,
                needsPerson: run["needsPerson"] as? Bool ?? false,
                problems: Self.truthy(run["problems"]),
                attention: run["attention"] as? Bool ?? false,
                recovered: Self.truthy(run["recovered"]),
                startedBy: run["startedBy"] as? String
            )
            XCTAssertEqual(ChatRelevance.signal(facts).rawValue, item["signal"] as? String, name)
        }
    }

    /// JavaScript truthiness of a vector field (a string, an object, a flag).
    private static func truthy(_ value: Any?) -> Bool {
        switch value {
        case nil, is NSNull: return false
        case let flag as Bool: return flag
        case let text as String: return !text.isEmpty
        default: return true
        }
    }
}
