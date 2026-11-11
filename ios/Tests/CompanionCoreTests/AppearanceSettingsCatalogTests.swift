// #3642: Settings > Appearance read in French showed one row in English
// ("Color 1:1 messages with the bot color"): its words were missing from
// the string catalog. Every sentence of the page comes from the catalog in
// French like its neighbours, and that row in every language the catalog
// carries.
import Foundation
import XCTest

final class AppearanceSettingsCatalogTests: XCTestCase {
    private let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    private func catalog() throws -> [String: Any] {
        let data = try Data(contentsOf: root.appendingPathComponent("App/Localizable.xcstrings"))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        return try XCTUnwrap(json["strings"] as? [String: Any])
    }

    private func translated(_ strings: [String: Any], _ key: String, _ language: String) -> Bool {
        let entry = strings[key] as? [String: Any]
        let unit = ((entry?["localizations"] as? [String: Any])?[language] as? [String: Any])?["stringUnit"] as? [String: Any]
        return unit?["state"] as? String == "translated" && !((unit?["value"] as? String) ?? "").isEmpty
    }

    /// The literal words the page draws (titles, subtitles, section labels).
    private func pageWords() throws -> [String] {
        let text = try String(contentsOf: root.appendingPathComponent("App/AppearanceSettingsView.swift"), encoding: .utf8)
        let pattern = try NSRegularExpression(pattern: #"(?:title|subtitle|text): "((?:[^"\\]|\\.)*)""#)
        let range = NSRange(text.startIndex..., in: text)
        return pattern.matches(in: text, range: range).compactMap { match in
            Range(match.range(at: 1), in: text).map { String(text[$0]) }
        }.filter { !$0.contains("\\(") }
    }

    func testEverySentenceOfThePageIsInFrench() throws {
        let strings = try catalog()
        let words = try pageWords()
        XCTAssertTrue(words.contains("Color 1:1 messages with the bot color"))
        for key in words {
            XCTAssertTrue(translated(strings, key, "fr"), "Settings > Appearance stays in English in French: \(key)")
        }
    }

    func testTheBotColorRowIsInEveryLanguageOfTheCatalog() throws {
        let strings = try catalog()
        var languages = Set<String>()
        for case let entry as [String: Any] in strings.values {
            languages.formUnion(((entry["localizations"] as? [String: Any]) ?? [:]).keys)
        }
        XCTAssertTrue(languages.isSuperset(of: ["en", "fr"]))
        for key in ["Color 1:1 messages with the bot color", "Assistant bubbles and cards in a one-to-one chat use the bot's color. Off leaves them in the skin's color."] {
            for language in languages.sorted() {
                XCTAssertTrue(translated(strings, key, language), "\(key) has no \(language) words")
            }
        }
    }
}
