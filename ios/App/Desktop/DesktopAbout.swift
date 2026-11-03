// About on the large layout: the desktop's `AboutDialog.tsx` (AboutCard in
// AboutWindow), a small centred window of 400 pt at most: the Pulsatrix owl
// (56 x 50), "Sagax", "Version x . iPadOS", one card of link rows (Release
// notes >, GitHub, Documentation, License), then the copyright in grey.
import SwiftUI
import UIKit

struct DesktopAboutModal: View {
    @Environment(\.desktopTheme) private var theme
    let close: () -> Void
    let openReleaseNotes: () -> Void
    @State private var link: URL?

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.black.opacity(0.5)
                    .contentShape(Rectangle())
                    .onTapGesture(perform: close)
                    .accessibilityHidden(true)
                AnyView(box)
                    .frame(width: min(400, geometry.size.width - 24))
                    .frame(maxHeight: geometry.size.height - 48)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .ignoresSafeArea()
        .background(DesktopEscapeKey(action: close))
        .sheet(item: Binding(get: { link.map(IdentifiedURL.init) }, set: { link = $0?.url })) { item in
            SafariSheet(url: item.url).ignoresSafeArea()
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-about")
    }

    private var box: some View {
        VStack(spacing: 12) {
            VStack(spacing: 0) {
                PulsatrixLogoMark(size: 56)
                    .foregroundStyle(theme.ink)
                    .accessibilityIdentifier("about-mark")
                Text(verbatim: "Sagax")
                    .font(theme.font(17, .semibold))
                    .tracking(-0.14)
                    .foregroundStyle(theme.ink)
                    .padding(.top, 12)
                    .accessibilityIdentifier("about-title")
                Text(verbatim: "\(String(localized: "Version \(AboutPage.version)")) · \(AboutPage.platform)")
                    .font(theme.font(13))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.top, 2)
                    .accessibilityIdentifier("about-version")
            }
            .frame(maxWidth: .infinity)
            VStack(spacing: 0) {
                row(String(localized: "Release notes"), icon: .chevronRight, id: "about-release-notes") { openReleaseNotes() }
                row("GitHub", icon: .externalLink, id: "about-github") { link = AboutLinks.repository }
                row(String(localized: "Documentation"), icon: .externalLink, id: "about-docs") { link = AboutLinks.docs }
                row(String(localized: "License"), icon: .externalLink, id: "about-license") { link = AboutLinks.license }
            }
            .padding(.vertical, 6)
            .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.border, lineWidth: 0.5))
            VStack(spacing: 0) {
                Text("© 2026 Pulsatrix Technologies inc. Open source under the Apache License 2.0.")
                Text("Based on OpenMausBot \(AboutLicense.basedOnVersion)")
            }
            .font(theme.font(12))
            .multilineTextAlignment(.center)
            .foregroundStyle(theme.inkSecondary)
            .padding(.horizontal, 4)
            .accessibilityIdentifier("about-footer")
        }
        .padding(.horizontal, 20)
        .padding(.top, 28)
        .padding(.bottom, 20)
        .overlay(alignment: .topTrailing) {
            Button(action: close) {
                DesktopIconView(icon: .x, size: 18, strokeWidth: 2)
                    .foregroundStyle(theme.inkTertiary)
                    .frame(width: 32, height: 32)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .padding(10)
            .accessibilityLabel(Text("Close"))
            .accessibilityIdentifier("about-close")
        }
        .background(theme.app)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
    }

    /// `LinkRow`: 36 pt (44 pt for a finger), 13/18, the glyph 14 pt grey at the end.
    private func row(_ title: String, icon: DesktopIcon, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Text(verbatim: title).font(theme.font(13)).foregroundStyle(theme.ink).lineLimit(1)
                Spacer(minLength: 0)
                DesktopIconView(icon: icon, size: 14, strokeWidth: 2).foregroundStyle(theme.inkSecondary)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(DesktopHoverFill(radius: 0))
        .accessibilityIdentifier(id)
    }
}
