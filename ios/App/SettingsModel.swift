// What the Settings sheet shows, read from the paired computer or server and
// written back through it: the account card, usage, the Bot section's
// settings and rule count, and the installed plugin count. One model per
// open sheet, shared by its pages.
import CompanionCore
import SwiftUI
import UIKit

@MainActor
final class SettingsModel: ObservableObject {
    @Published private(set) var identity: AccountIdentity?
    @Published private(set) var usage: UsageSummary?
    var usagePercent: Int? { usage?.budgetPercent }
    @Published private(set) var botSettings: BotSettingsResponse?
    @Published private(set) var rules: AutoReviewRules?
    @Published private(set) var installedCount: Int?
    /// `GET /.well-known/openmausbot/environment` `version`, when reachable.
    @Published private(set) var serverVersion: String?
    @Published var error: String?

    private weak var session: Session?

    func attach(_ session: Session) {
        self.session = session
    }

    private var client: CompanionClient? { session?.settingsClient }

    /// Everything the root page shows, each part on its own: a server that
    /// refuses one route (403 for a member, 404 on an older one) leaves that
    /// row in its empty state and the others still load.
    func load() async {
        // Right after launch the first reads can race the connection coming
        // up; a pass where nothing answered is tried twice more.
        for attempt in 0..<3 {
            await loadOnce()
            if (identity != nil && usage != nil && botSettings != nil) || attempt == 2 { break }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
        }
        await syncTimeZoneIfAutomatic()
    }

    private func loadOnce() async {
        guard let client else { return }
        async let identity = try? client.accountIdentity()
        async let usage = try? client.usage()
        async let settings = try? client.botSettings()
        async let rules = try? client.autoReviewRules()
        async let installed = try? client.installedPlugins()
        async let environment = try? client.environment()
        let loadedIdentity = await identity
        self.identity = loadedIdentity
        self.usage = await usage
        botSettings = await settings
        self.rules = await rules
        installedCount = await installed?.count
        serverVersion = await environment?.version
        // The photo lives on the session (Session.accountPhoto), shared with
        // the home: opening Settings brings it up to date too.
        if let loadedIdentity, let session, let connectionID = session.connection?.id {
            await session.refreshAccountPhoto(loadedIdentity.avatar, connectionID: connectionID)
        }
    }

    // MARK: Account card

    var connectionName: String { session?.connection?.name ?? String(localized: "Not connected") }
    var displayName: String { identity?.displayName(fallback: connectionName) ?? connectionName }
    /// Under the name: the person's email, else the account this phone is
    /// signed in with, else "Personal account"; never the server's address.
    var detail: String? {
        if let email = identity?.detail { return email }
        if let email = session?.account?.email, email != displayName { return email }
        return identity == nil ? nil : String(localized: "Personal account")
    }

    // MARK: Bot settings

    var timeZoneAuto: Bool { botSettings?.settings.timeZoneAuto ?? false }
    var timeZone: String? { botSettings?.displayTimeZone }

    func setTimeZoneAuto(_ on: Bool) async {
        await save(on
            ? BotSettingsPatch(timeZone: TimeZone.current.identifier, timeZoneAuto: true)
            : BotSettingsPatch(timeZoneAuto: false))
    }

    func setTimeZone(_ identifier: String) async {
        await save(BotSettingsPatch(timeZone: identifier, timeZoneAuto: false))
    }

    /// With automatic time zone on, the phone's own zone is sent whenever the
    /// sheet opens and the phone's zone differs from the saved one.
    func syncTimeZoneIfAutomatic() async {
        guard let settings = botSettings?.settings, settings.timeZoneAuto,
              settings.timeZone != TimeZone.current.identifier else { return }
        await save(BotSettingsPatch(timeZone: TimeZone.current.identifier))
    }

    private func save(_ patch: BotSettingsPatch) async {
        guard let client else { return }
        // Shown at once; the server's answer replaces it.
        if var optimistic = botSettings {
            if let value = patch.autoReviewDefault { optimistic.settings.autoReviewDefault = value }
            if let value = patch.timeZoneAuto { optimistic.settings.timeZoneAuto = value }
            if let value = patch.timeZone { optimistic.settings.timeZone = value }
            botSettings = optimistic
        }
        do {
            botSettings = try await client.updateBotSettings(patch)
        } catch {
            self.error = error.localizedDescription
            botSettings = try? await client.botSettings()
        }
    }

    // MARK: Rules

    func reloadRules() async {
        guard let client else { return }
        do { rules = try await client.autoReviewRules() } catch { self.error = error.localizedDescription }
    }

    func deleteRule(_ rule: AutoReviewRule) async {
        guard let client else { return }
        if var current = rules {
            current.rules.removeAll { $0.id == rule.id }
            current.global.removeAll { $0.id == rule.id }
            current.total = max(0, current.total - 1)
            rules = current
        }
        do { rules = try await client.deleteAutoReviewRule(id: rule.id) } catch {
            self.error = error.localizedDescription
            await reloadRules()
        }
    }

    func setInstalledCount(_ count: Int) {
        installedCount = count
    }
}
