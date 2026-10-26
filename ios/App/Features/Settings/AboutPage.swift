// Settings > About (matrix ST12), the desktop's AboutDialog: the app's
// name, its version and build with the platform, the notice, and the
// GitHub, Docs, Releases and License links. The phone adds the computer it
// is paired with. The desktop shows no server version and no route gives
// one, so neither does the phone.
import CompanionCore
import SwiftUI
import UIKit

enum AboutLinks {
    static let repository = URL(string: "https://github.com/pulsatrixtechnologies/sagax")!
    static let docs = URL(string: "https://github.com/pulsatrixtechnologies/sagax/tree/main/docs")!
    static let releases = URL(string: "https://github.com/pulsatrixtechnologies/sagax/releases")!
    static let license = URL(string: "https://github.com/pulsatrixtechnologies/sagax/blob/main/LICENSE")!
}

struct AboutPage: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @State private var link: URL?
    @State private var copied = false

    static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev" }
    static var build: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?" }
    static var platform: String { UIDevice.current.userInterfaceIdiom == .pad ? "iPadOS" : "iOS" }

    var body: some View {
        SettingsPage(title: "About") {
            VStack(spacing: 8) {
                Image("SagaxMark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 56, height: 56)
                    .accessibilityHidden(true)
                Text(verbatim: "Pulsatrix Sagax")
                    .font(Theme.Font.profileName)
                    .foregroundStyle(Theme.textPrimary)
                Text("Version \(Self.version) (\(Self.build)) · \(Self.platform) \(UIDevice.current.systemVersion)")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("about-version")
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, 20)
            SettingsCard {
                SettingsRow(title: "Copy version", accessory: copied ? .value(String(localized: "Copied")) : .none, identifier: "about-copy-version") {
                    PlatformBridge.copyToPasteboard(AppVersionText.line(version: Self.version, build: Self.build, platform: Self.platform, osVersion: UIDevice.current.systemVersion))
                    copied = true
                }
            }
            SettingsSpacer(SettingsMetrics.cardGap)
            if let connection = session.connection {
                SettingsCard {
                    SettingsRow(title: "Computer", accessory: .value(connection.name), identifier: "about-computer")
                }
                SettingsSpacer(SettingsMetrics.cardGap)
            }
            SettingsCard {
                SettingsRow(title: "GitHub", accessory: .chevron, identifier: "about-github") { link = AboutLinks.repository }
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "Docs", accessory: .chevron, identifier: "about-docs") { link = AboutLinks.docs }
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "Releases", accessory: .chevron, identifier: "about-releases") { link = AboutLinks.releases }
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "License", accessory: .chevron, identifier: "about-license") { link = AboutLinks.license }
            }
            SettingsFooter(text: "A desktop home for your agents. © 2026 Pulsatrix Technologies inc. Free for noncommercial use (PolyForm Noncommercial 1.0.0).")
        }
        .sheet(item: Binding(get: { link.map(IdentifiedURL.init) }, set: { link = $0?.url })) { item in
            SafariSheet(url: item.url).ignoresSafeArea()
        }
    }
}
