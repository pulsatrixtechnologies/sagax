// Settings > About, the desktop's AboutDialog (2026-10-16, drawn as the
// iOS About of #563): the Pulsatrix mark, "Sagax", the version with the
// platform, then Release notes, GitHub, Docs and License as rows of one
// card, the copyright in grey at the bottom. No Sagax owl, no computer,
// no Releases link: the desktop shows none of them.
import CompanionCore
import SwiftUI
import UIKit

enum AboutLinks {
    static let repository = URL(string: "https://github.com/pulsatrixtechnologies/sagax")!
    static let docs = URL(string: "https://github.com/pulsatrixtechnologies/sagax/tree/main/docs")!
    static let license = URL(string: "https://github.com/pulsatrixtechnologies/sagax/blob/main/LICENSE")!
}

struct AboutPage: View {
    @Environment(\.themePalette) var themePalette
    @State private var link: URL?
    @State private var showingReleaseNotes = false
    @State private var copied = false

    static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev" }
    static var build: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?" }
    static var platform: String { UIDevice.current.userInterfaceIdiom == .pad ? "iPadOS" : "iOS" }

    var body: some View {
        SettingsPage(title: "About") {
            VStack(spacing: 0) {
                PulsatrixLogoMark(size: 56)
                    .accessibilityIdentifier("about-mark")
                Text(verbatim: "Sagax")
                    .font(Theme.Font.profileName)
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.top, 12)
                // a tap copies the line a bug report quotes
                Text(copied ? String(localized: "Copied") : String(localized: "Version \(Self.version) (\(Self.build)) · \(Self.platform) \(UIDevice.current.systemVersion)"))
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.top, 2)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        PlatformBridge.copyToPasteboard(AppVersionText.line(version: Self.version, build: Self.build, platform: Self.platform, osVersion: UIDevice.current.systemVersion))
                        Haptics.selection()
                        copied = true
                        Task { try? await Task.sleep(nanoseconds: 1_500_000_000); copied = false }
                    }
                    .accessibilityAddTraits(.isButton)
                    .accessibilityHint(Text("Copy version"))
                    .accessibilityIdentifier("about-version")
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, 20)
            SettingsCard {
                SettingsRow(title: "Release notes", accessory: .chevron, identifier: "about-release-notes") { showingReleaseNotes = true }
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "GitHub", accessory: .chevron, identifier: "about-github") { link = AboutLinks.repository }
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "Docs", accessory: .chevron, identifier: "about-docs") { link = AboutLinks.docs }
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "License", accessory: .chevron, identifier: "about-license") { link = AboutLinks.license }
            }
            SettingsFooter(text: "© 2026 Pulsatrix Technologies inc. Open source under the Apache License 2.0.")
        }
        .navigationDestination(isPresented: $showingReleaseNotes) { ReleaseNotesPage() }
        .sheet(item: Binding(get: { link.map(IdentifiedURL.init) }, set: { link = $0?.url })) { item in
            SafariSheet(url: item.url).ignoresSafeArea()
        }
    }
}
