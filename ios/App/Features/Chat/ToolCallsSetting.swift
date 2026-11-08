// Settings > Appearance > Tool calls ("Details" in the chat), the desktop's
// switch (`features.showToolCalls` on the server, AppearanceSettings.tsx
// ToolCallsRow): off, the chat reads like the reference app (steps gone, a turn's
// narration folded, failures kept); on, every step shows. One setting for
// the desktop, the iPad and the iPhone, read from GET /api/config and
// refreshed by the stream's `config` frame. Last value kept on this phone
// so the first frame of a chat already draws the right way.
import CompanionCore
import SwiftUI

@MainActor
final class ToolCallsSetting: ObservableObject {
    static let shared = ToolCallsSetting()

    private static let cacheKey = "companion.prefs.showToolCalls"

    @Published private(set) var showToolCalls: Bool
    @Published private(set) var saving = false
    @Published var error: String?

    private init() {
        showToolCalls = UserDefaults.standard.bool(forKey: Self.cacheKey)
    }

    /// What the chat, the home's previews and the iPad sidebar show.
    var detail: ActivityDetail { ActivityDetail.forToolCalls(showToolCalls) }

    func load(_ session: Session) async {
        guard let client = session.settingsClient,
              let config = try? await client.desktopSettingsConfig() else { return }
        apply(config.features?.showToolCalls == true)
    }

    func set(_ session: Session, _ on: Bool) async {
        guard let client = session.settingsClient, !saving else { return }
        saving = true
        error = nil
        defer { saving = false }
        do {
            let config = try await client.updateDesktopSettings(.feature("showToolCalls", on))
            apply(config.features?.showToolCalls == true)
        } catch {
            self.error = String(localized: "Could not save the tool calls setting.")
        }
    }

    private func apply(_ on: Bool) {
        UserDefaults.standard.set(on, forKey: Self.cacheKey)
        if showToolCalls != on { showToolCalls = on }
    }
}
