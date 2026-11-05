// About on the large layout: the desktop's `AboutDialog.tsx` (AboutCard in
// AboutWindow), a small centred window of 400 pt at most: the Pulsatrix owl
// (56 x 50), "Sagax", "Version x . iPadOS", one card of link rows (Release
// notes >, GitHub, Documentation, License), then the copyright in grey.
import SwiftUI
import UIKit
import CompanionCore

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
                DesktopOwlMark()
                    .frame(width: 56, height: 50)
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
            .padding(.vertical, 8)
            .frame(minHeight: 36)
            .contentShape(Rectangle())
        }
        .buttonStyle(DesktopHoverFill(radius: 0))
        .accessibilityIdentifier(id)
    }
}

/// `PulsatrixOwlMark` (PulsatrixOwlMark.tsx): the owl in the ink, its eyes
/// and pulse line in Pulsatrix blue, drawn from the desktop's own paths.
struct DesktopOwlMark: View {
    @Environment(\.desktopTheme) private var theme
    static let ink = "M0.03 1.65L0.01 2.94L1.17 3.03L2.88 3.32L4.83 3.89L6.09 4.41L8.36 5.69L9.9 6.89L11.19 8.18L12.22 9.49L13.25 11.16L14 12.59L15.09 10.53L15.83 9.38L17.15 7.78C18.96 5.93 21.11 4.51 23.61 3.76L25.57 3.25L26.2 3.14L27.23 3.02L27.91 2.97L27.94 1.68L26.71 1.71C26.11 1.71 25.23 1.88 24.65 2.04C23.56 2.26 22.45 2.65 21.43 3.12L19.7 4.02L18.32 4.94L17.01 6.03L16 7.03C15.22 7.86 14.58 8.75 14 9.72L12.68 7.83L12.05 7.09L10.99 6.03L9.9 5.12L8.59 4.2L6.49 3.09L4.54 2.35L2.66 1.88L1.52 1.7L0.03 1.65ZM11.62 11.53L10.85 10.4L10.45 10.81C10.04 11.23 9.68 11.46 9.12 11.66C7.58 12.06 6.35 11.51 5.53 10.18L5.21 9.18C5.21 8.66 5.21 8.32 5.33 7.81L5.84 6.84L6.18 6.49L5.01 5.89L4.9 5.94C4.62 6.22 4.3 6.79 4.17 7.17C3.95 7.69 3.78 8.5 3.89 9.06C3.9 9.56 4.01 10.06 4.23 10.51C4.39 10.98 4.72 11.43 5.07 11.79C6.2 13.08 8.05 13.44 9.64 12.92C10.59 12.51 10.9 12.25 11.62 11.53ZM21.82 6.49C23.39 8.12 23.01 10.55 20.98 11.54C20.34 11.76 20.06 11.78 19.38 11.78L19.05 11.72L17.98 11.24L17.15 10.39L17.05 10.49L16.38 11.53L17.12 12.27C17.68 12.62 18.07 12.84 18.71 13.03L19.38 13.15C20.05 13.17 20.58 13.13 21.21 12.92L22.16 12.44L22.99 11.72L23.56 10.92C24.14 9.79 24.27 8.7 23.92 7.47L23.56 6.63L23.05 5.89C22.72 5.93 22.08 6.27 21.82 6.49ZM4.15 12.93L4.37 14.49C4.86 16.41 5.77 18.34 7.16 19.78L8.21 20.83C8.81 21.41 9.64 22.01 10.36 22.41C10.77 22.65 12.16 23.37 12.57 23.36L11.71 21.63L10.42 20.86L9.39 20.11L8.22 19L7.3 17.85L6.2 15.87L5.58 14.02L4.98 13.64L4.15 12.93ZM22.36 14.08C22.19 14.87 21.9 15.56 21.57 16.31L21.04 17.28L20.24 18.42L18.9 19.83L18.04 20.52L16.23 21.63L15.42 23.38L16.99 22.73C18.9 21.8 20.92 20.02 22.02 18.2C22.36 17.72 22.78 16.96 22.97 16.4L23.49 14.86C23.63 14.4 23.86 13.38 23.79 12.93L22.36 14.08Z"
    static let blue = "M7.64 7.38C7.12 7.67 6.86 7.87 6.75 8.49L6.76 9.01C6.91 9.88 7.54 10.24 8.39 10.24L9.05 9.98C9.38 9.66 9.47 9.56 9.65 9.12L8.47 7.98L7.64 7.38ZM18.32 9.06C18.37 9.43 18.52 9.66 18.81 9.89C20.38 11.19 22.5 8.65 20.36 7.38C19.62 7.82 18.94 8.45 18.32 9.06ZM8.64 8.49C8.66 8.83 8.68 8.82 8.46 9.06L8.02 9.06C7.56 8.56 8.11 7.91 8.64 8.49ZM20.09 8.49L20.08 8.89L19.92 9.06L19.53 9.06L19.3 8.84C19.29 8.53 19.28 8.54 19.48 8.32C19.82 8.22 19.84 8.23 20.09 8.49ZM13.8 15.08L12.63 18.82L12.14 17.88L7.9 17.88L8.52 18.63L11.71 18.66L12.68 20.65L12.97 20.54L14 17L14.97 20.6L15.2 20.72L15.32 20.66L16.25 18.68L19.42 18.63L20.04 17.88L15.8 17.88L15.32 18.88L14.5 16.1C14.41 15.79 14.35 15.32 14.14 15.08L13.8 15.08Z"
    static let deep = "M8.73 8.39L8.74 8.52C8.77 8.84 8.7 8.95 8.47 9.18L9.08 9.61L9.45 9.01L8.73 8.39ZM18.44 9.06L18.75 9.67L19.47 9.12C19.2 8.96 19.17 8.71 19.21 8.42C18.87 8.59 18.71 8.8 18.44 9.06Z"

    var body: some View {
        Canvas { context, size in
            let scale = min(size.width / 28, size.height / 25)
            context.translateBy(x: (size.width - 28 * scale) / 2, y: (size.height - 25 * scale) / 2)
            context.scaleBy(x: scale, y: scale)
            context.fill(Path(SVGPath.cached(Self.ink)), with: .color(theme.ink), style: FillStyle(eoFill: true))
            context.fill(Path(SVGPath.cached(Self.blue)), with: .color(Color(red: 0x34 / 255, green: 0x66 / 255, blue: 0xDC / 255)), style: FillStyle(eoFill: true))
            context.fill(Path(SVGPath.cached(Self.deep)), with: .color(Color(red: 0x20 / 255, green: 0x4C / 255, blue: 0xB6 / 255)))
        }
        .accessibilityLabel(Text(verbatim: "Pulsatrix"))
    }
}
