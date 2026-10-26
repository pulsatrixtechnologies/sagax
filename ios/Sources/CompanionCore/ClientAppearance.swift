// "Same as my computer" (Settings > Appearance): the computer's skin and font.
//
// An organization server keeps them in the person's preferences
// (`GET/PUT /api/me/preferences`). A personal computer answers 404 there; its
// desktop app hands its look to `GET/PUT /api/me/appearance` instead
// (server/routes/desktop-appearance.ts), which the companion allows.
import Foundation

/// Where the computer keeps its look.
public enum ComputerAppearanceSource: String, Sendable {
    case organization
    case personal
}

public struct ComputerAppearanceRecord: Equatable, Sendable {
    public var appearance: ComputerAppearance
    public var source: ComputerAppearanceSource
    /// True when the computer holds a saved choice (else its defaults).
    public var stored: Bool
}

struct DesktopAppearanceBody: Encodable {
    var preferences: [String: String]
}

extension CompanionClient {
    /// The computer's look, or nil when neither route exists (an older computer).
    public func computerAppearance() async throws -> ComputerAppearanceRecord? {
        do {
            let record = try await preferences()
            return ComputerAppearanceRecord(appearance: ComputerAppearance(preferences: record.preferences), source: .organization, stored: record.stored)
        } catch let APIError.status(code, _) where code == 404 || code == 403 {
            // a personal computer: its desktop's look
        }
        do {
            let record = try await send(makeRequest("GET", "/api/me/appearance"), as: UserPreferences.self)
            return ComputerAppearanceRecord(appearance: ComputerAppearance(preferences: record.preferences), source: .personal, stored: record.stored)
        } catch let APIError.status(code, _) where code == 404 || code == 403 {
            return nil
        }
    }

    /// Writes the phone's choice back to the computer. On an organization
    /// server the whole record is replaced, so it is read first and only
    /// the appearance keys change.
    public func saveComputerAppearance(_ values: [String: String], to source: ComputerAppearanceSource) async throws {
        let keys = [DesktopAppearanceKeys.skin, DesktopAppearanceKeys.skinMode, DesktopAppearanceKeys.font, DesktopAppearanceKeys.retroOn, DesktopAppearanceKeys.retroUnlocked]
        switch source {
        case .organization:
            var record = try await preferences().preferences
            for key in keys { record[key] = values[key] ?? (key == DesktopAppearanceKeys.retroUnlocked ? record[key] : nil) }
            _ = try await putPreferences(record)
        case .personal:
            var body: [String: String] = [:]
            for key in keys { body[key] = values[key] }
            try await send(makeRequest("PUT", "/api/me/appearance", encodedBody: DesktopAppearanceBody(preferences: body)))
        }
    }
}
