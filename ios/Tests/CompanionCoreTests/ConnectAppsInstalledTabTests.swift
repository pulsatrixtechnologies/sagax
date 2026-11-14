// #4213: on the iPad, Connect apps opens in the desktop window. Its
// Installed tab drew the This iPhone switches piled up (a list's Toggle rows
// inside the window's plain stack, with no row of their own) and some lines
// stayed in English in French (the words were missing from the string
// catalog) or said "vous". Every switch is a row of its own there, aligned
// like the phone's rows, and every line of the tab reads in French Quebec
// with "tu".
import Foundation
import XCTest

final class ConnectAppsInstalledTabTests: XCTestCase {
    private let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    private func source(_ path: String) throws -> String {
        try String(contentsOf: root.appendingPathComponent(path), encoding: .utf8)
    }

    /// The text between `start` and the next `end` (a struct, a function).
    private func slice(_ text: String, from start: String, to end: String) throws -> String {
        let from = try XCTUnwrap(text.range(of: start), "\(start) is in the file")
        let rest = text[from.upperBound...]
        let to = rest.range(of: end)?.lowerBound ?? rest.endIndex
        return String(text[from.lowerBound..<to])
    }

    private func catalog() throws -> [String: Any] {
        let data = try Data(contentsOf: root.appendingPathComponent("App/Localizable.xcstrings"))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        return try XCTUnwrap(json["strings"] as? [String: Any])
    }

    private func french(_ strings: [String: Any], _ key: String) -> String? {
        let entry = strings[key] as? [String: Any]
        let unit = ((entry?["localizations"] as? [String: Any])?["fr"] as? [String: Any])?["stringUnit"] as? [String: Any]
        guard unit?["state"] as? String == "translated", let value = unit?["value"] as? String, !value.isEmpty else { return nil }
        return value
    }

    /// The catalog keys a piece of Swift draws: its literals, an
    /// interpolation becoming %@ (or %lld for a count).
    private func keys(_ text: String) throws -> [[String]] {
        let pattern = try NSRegularExpression(
            pattern: #"(?:String\(localized:\s*|Text\(|DesktopText\(|Button\(|Toggle\(|Label\(|Section\()"((?:[^"\\]|\\.)*)""#)
        let range = NSRange(text.startIndex..., in: text)
        return pattern.matches(in: text, range: range).compactMap { match -> [String]? in
            guard let r = Range(match.range(at: 1), in: text) else { return nil }
            let literal = String(text[r])
            // an interpolation holding a quoted literal: not one simple key
            if literal.contains("\\(") && literal.range(of: #"\\\([^)]*\)"#, options: .regularExpression) == nil { return nil }
            if literal.contains("\\(") && literal.replacingOccurrences(of: #"\\\([^)]*\)"#, with: "", options: .regularExpression).contains(where: { "()".contains($0) }) { return nil }
            let plain = literal.replacingOccurrences(of: "\\\"", with: "\"")
            let object = plain.replacingOccurrences(of: #"\\\([^)]*\)"#, with: "%@", options: .regularExpression)
            let count = plain.replacingOccurrences(of: #"\\\([^)]*\)"#, with: "%lld", options: .regularExpression)
            return [object, count]
        }
    }

    /// The Installed tab of the desktop window: This iPhone, the entries and
    /// private skills, Providers and the person's own MCP servers.
    private func tabSources() throws -> [String: String] {
        let page = try source("App/Features/Plugins/ConnectAppsPage.swift")
        let mac = try source("App/Features/Plugins/MacMessagesSetupView.swift")
        let tools = try source("App/Features/PhoneTools/PhoneToolCard.swift")
        return [
            "ConnectAppsManage": try slice(page, from: "struct ConnectAppsManage", to: "\nstruct ConnectAppsProviders"),
            "PhoneIntegrationsSection": try slice(mac, from: "struct PhoneIntegrationsSection", to: "\n}\n"),
            "MacMessagesCopy": try slice(mac, from: "enum MacMessagesCopy", to: "\n}\n"),
            "PhoneToolWords.name": try slice(tools, from: "static func name(_ tool: PhoneTool)", to: "\n    }\n"),
            "DesktopProvidersSection": try source("App/Features/Plugins/DesktopProvidersSection.swift"),
            "DesktopMyConnections": try source("App/Desktop/DesktopMyConnections.swift"),
        ]
    }

    /// "vous", "votre", "vos" or a verb said to "vous" (Trouvez, Ajoutez).
    private func saysVous(_ value: String) -> Bool {
        let words = value.lowercased().components(separatedBy: CharacterSet.letters.inverted)
        return words.contains { ["vous", "votre", "vos"].contains($0) || ($0.count > 4 && $0.hasSuffix("ez") && !["assez"].contains($0)) }
    }

    func testEveryLineOfTheInstalledTabIsInFrenchWithTu() throws {
        let strings = try catalog()
        var checked = 0
        for (name, text) in try tabSources() {
            for candidates in try keys(text) {
                // a symbol, an identifier or a number is not a line
                guard candidates[0].contains(where: \.isLetter), candidates[0].count > 1 || candidates[0] == "%@" else { continue }
                guard let key = candidates.first(where: { strings[$0] != nil }) else {
                    XCTFail("\(name): \"\(candidates[0])\" is not in the string catalog, so it stays in English in French")
                    continue
                }
                guard let value = french(strings, key) else {
                    XCTFail("\(name): \"\(key)\" has no French words")
                    continue
                }
                XCTAssertFalse(saysVous(value), "\(name): \"\(key)\" says vous in French: \(value)")
                checked += 1
            }
        }
        XCTAssertGreaterThan(checked, 40)
        // the lines seen in English on the iPad
        for key in ["This iPhone", "Home", "Alarms",
                    "iOS does not let an app read or send iMessage. That connection stays in the Sagax app on your Mac.",
                    "Turn on what your bots may ask this iPhone for. You still approve each request in the app."] {
            XCTAssertNotNil(french(strings, key), "\(key) has French words")
        }
    }

    /// "app" in an entry's line ("app + 2 connectors") is a word of the
    /// catalog too, never a bare English literal.
    func testWhatAnEntryBringsIsWordedByTheCatalog() throws {
        let page = try source("App/Features/Plugins/ConnectAppsPage.swift")
        let brings = try slice(page, from: "private func brings(_ brings: InstalledBrings)", to: "\n    }\n")
        XCTAssertFalse(brings.contains("? [\"app\"]"), "the word app is not localized")
        XCTAssertFalse(brings.contains("([\"app\"]"), "the word app is not localized")
        XCTAssertTrue(brings.contains("String(localized: \"app\")"))
    }

    /// In the desktop window (a plain stack, no list rows), This iPhone is a
    /// settings group: the Messages line, then one row per tool with its
    /// glyph and name at the left and the window's switch at the right,
    /// never a list Toggle that has no row to sit in.
    func testThisIPhoneSwitchesAreOneRowEachInTheDesktopWindow() throws {
        let mac = try source("App/Features/Plugins/MacMessagesSetupView.swift")
        let section = try slice(mac, from: "struct PhoneIntegrationsSection", to: "\n}\n")
        XCTAssertTrue(section.contains("@Environment(\\.capabilitiesDesktop)"), "the section knows it is in the desktop window")
        let desktop = try slice(section, from: "private var desktopBody", to: "\n    }\n")
        XCTAssertTrue(desktop.contains("DesktopSettingsGroup("), "one card of rows, like the window's other settings")
        XCTAssertTrue(desktop.contains("DesktopSwitch("), "the window's own switch")
        XCTAssertFalse(desktop.contains("Toggle("), "a list Toggle piles up outside a list")
        XCTAssertTrue(desktop.contains("ForEach(tools)"), "one row per tool")
        XCTAssertTrue(desktop.contains("minHeight: 44"), "the row keeps the compact row's height")
        XCTAssertTrue(desktop.contains("connect-apps-phone-\\(tool.rawValue)"), "the row keeps its identifier")
        // the phone keeps its list rows
        let phone = try slice(section, from: "private var phoneBody", to: "\n    }\n")
        XCTAssertTrue(phone.contains("Toggle(isOn: binding(tool))"))
        // and the Installed tab of the window draws the same section
        let page = try source("App/Features/Plugins/ConnectAppsPage.swift")
        let installed = try slice(page, from: "private var desktopInstalled", to: "// MARK: Installed: one line per thing")
        XCTAssertTrue(installed.contains("PhoneIntegrationsSection()"))
    }
}
