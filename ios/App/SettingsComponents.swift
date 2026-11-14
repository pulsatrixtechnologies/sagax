// Building blocks of the Settings card sheet (iOS parity 12, 14, 15, 16, 21),
// at the measured geometry of measure-settings.md. Theme.swift holds the
// shared tokens; these parts are specific to the sheet's pages: the page
// frame with its glass header, the grouped card rows, and the safari and
// mail sheets the link rows open.
import CompanionCore
import MessageUI
import SafariServices
import SwiftUI
import UIKit

/// The sheet's measures (#4103): the bot panel's card, row and type
/// (`Theme.PhonePanel`, #4101) and the sheet's own (`PhoneSheetMetrics`),
/// measured on the reference app's sheets.
enum SettingsMetrics {
    /// The round control: 17 pt in from the sheet's leading and top edges.
    static let headerInset = CGFloat(PhonePanelMetrics.margin)
    /// The floating header's height: content and the top scroll-edge fade
    /// clear it, so no first row sits under the control.
    static let headerClearance: CGFloat = headerInset + GlassCircleButton.Size.large.rawValue
    static let headerFadeHeight: CGFloat = 78
    /// The page's coordinate space: a view in the list reads where it sits
    /// against the floating header (the root's search).
    static let sheetSpace = "settings-sheet"
    /// The first card's top, from the sheet's top.
    static let firstCardTop = CGFloat(PhoneSheetMetrics.firstCard)
    /// A title beside the control starts this far after it.
    static let titleGap = CGFloat(PhoneSheetMetrics.appsTitleGap)
    static let cardMargin = Theme.PhonePanel.margin
    /// Text, values and switches sit 20 pt from the card's edges.
    static let rowInset = Theme.PhonePanel.textInset
    static let trailingInset = Theme.PhonePanel.textInset
    /// The chevron's ink ends 24 pt before the card's trailing edge.
    static let chevronTrailing = Theme.PhonePanel.chevronTrailing
    static let cardGap = CGFloat(PhoneSheetMetrics.cardGap)
    /// Previous card bottom to the next card top when a group title sits between.
    static let labelledGap = CGFloat(PhoneSheetMetrics.titledGap) + 14.3 + Theme.PhonePanel.titleToCard
    static let footerGap: CGFloat = 30.3
    static let tracking135: CGFloat = 0
    /// The sheet's top corners.
    static let sheetRadius: CGFloat = 38
    /// A one-line row, the person's row, a two-line row's padding.
    static let row = Theme.PhonePanel.row
    static let personRow = CGFloat(PhoneSheetMetrics.personRow)
    static let twoLinePadding = CGFloat(PhoneSheetMetrics.twoLinePadding)
    static let lineGap = CGFloat(PhoneSheetMetrics.lineGap)
    static let valueGap = CGFloat(PhoneSheetMetrics.valueGap)
    /// A leading glyph (+, the bin) at the text inset, its words 50 pt in.
    static let glyphColumn: CGFloat = 30

    static var rowFont: Font { Theme.PhonePanel.rowFont }
    static var subtitleFont: Font { Theme.font(CGFloat(PhoneSheetMetrics.subtitleSize)) }
}

// MARK: - Page

/// One page of the sheet: the scrolling content under a floating header (a
/// glass X or back circle, an optional title and trailing control), with the
/// top scroll-edge fade over the header height.
struct SettingsPage<Trailing: View, Content: View>: View {
    @Environment(\.themePalette) var themePalette
    enum Leading { case close(() -> Void), back }

    var title: LocalizedStringKey?
    var leading: Leading = .back
    var contentTop: CGFloat = SettingsMetrics.firstCardTop
    var scrollable = true
    /// The trailing view takes the rest of the header row (the root's search).
    var trailingFills = false
    @ViewBuilder var trailing: () -> Trailing
    @ViewBuilder var content: () -> Content

    @Environment(\.dismiss) private var dismiss
    @Environment(\.settingsPop) private var settingsPop

    private var background: Color { Theme.bg }

    var body: some View {
        ZStack(alignment: .top) {
            SettingsSheetBackground()
            Group {
                if scrollable {
                    ScrollView(showsIndicators: false) { stack }
                        .topScrollEdgeFade(height: SettingsMetrics.headerFadeHeight, background: background, underStatusBar: false)
                } else {
                    stack
                }
            }
            .clipShape(SettingsSheetShape())
            header
        }
        .coordinateSpace(name: SettingsMetrics.sheetSpace)
        .toolbar(.hidden, for: .navigationBar)
    }

    private var stack: some View {
        VStack(spacing: 0) {
            Color.clear.frame(height: contentTop)
            content()
            Color.clear.frame(height: 40)
        }
        .frame(maxWidth: .infinity, alignment: .top)
    }

    /// The reference app's sheet header (2026-11-01): the round X or back at the
    /// leading corner, the title centred on the screen, a trailing control.
    private var header: some View {
        ZStack {
            HStack(spacing: 0) {
                switch leading {
                case let .close(action):
                    GlassCircleButton(systemImage: "xmark", size: .large, accessibilityLabel: "Close", action: action)
                        .chatGlassRim(Circle())
                        .accessibilityIdentifier("settings-close")
                case .back:
                    // the panel's back control: one round control for the phone
                    ProfileBackButton(identifier: "settings-back") {
                        if let settingsPop { settingsPop() } else { dismiss() }
                    }
                }
                if trailingFills {
                    trailing()
                        .frame(maxWidth: .infinity)
                        .padding(.leading, SettingsMetrics.titleGap)
                } else {
                    Spacer(minLength: 8)
                    trailing()
                }
            }
            if let title {
                Text(title)
                    .font(Theme.PhonePanel.titleBarFont)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                    .padding(.horizontal, GlassCircleButton.Size.large.rawValue + 20)
                    .allowsHitTesting(false)
                    .accessibilityAddTraits(.isHeader)
            }
        }
        .padding(.leading, SettingsMetrics.headerInset)
        .padding(.trailing, SettingsMetrics.headerInset)
        .padding(.top, SettingsMetrics.headerInset)
    }
}

/// The sheet's shape: reference app's card sheet, rounded at the top and
/// running past the bottom edge.
struct SettingsSheetShape: Shape {
    func path(in rect: CGRect) -> Path {
        Path(roundedRect: CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: rect.height + 80),
             cornerRadius: SettingsMetrics.sheetRadius, style: .continuous)
    }
}

/// Behind every Settings page: the dimmed strip under the status bar and
/// the sheet itself, as reference app presents its account sheet (2026-11-01).
/// Settings still covers the whole home (owner, 2026-10-26).
struct SettingsSheetBackground: View {
    @Environment(\.themePalette) var themePalette

    var body: some View {
        ZStack(alignment: .top) {
            Theme.bg.overlay(Color.black.opacity(themePalette.isDark ? 0.45 : 0.18)).ignoresSafeArea()
            SettingsSheetShape()
                .fill(Theme.bg)
                .ignoresSafeArea(edges: .bottom)
        }
        .accessibilityHidden(true)
    }
}

extension SettingsPage where Trailing == EmptyView {
    init(title: LocalizedStringKey? = nil, leading: Leading = .back, contentTop: CGFloat = SettingsMetrics.firstCardTop,
         scrollable: Bool = true, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.leading = leading
        self.contentTop = contentTop
        self.scrollable = scrollable
        self.trailing = { EmptyView() }
        self.content = content
    }
}

// MARK: - Cards

/// A grouped card at the sheet's margin: the bot panel's card (#4101),
/// with its faint outline, so the phone has one grouped card (#4103).
struct SettingsCard<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        ProfileCard(margin: SettingsMetrics.cardMargin, content: content)
            .environment(\.profileCardOutlined, true)
    }
}

/// The muted group title above a card ("Bot", "Switch Account"): the bot
/// panel's group title (#4101) at the card's text inset, in the gap the
/// sheet keeps between two cards.
struct SettingsSectionLabel: View {
    @Environment(\.themePalette) var themePalette
    let text: LocalizedStringKey

    var body: some View {
        PanelGroupTitle(text: text)
            .padding(.horizontal, SettingsMetrics.cardMargin)
            .frame(height: SettingsMetrics.labelledGap, alignment: .bottom)
    }
}

/// The muted sentence under a card: the bot panel's footnote (#4101).
struct SettingsFooter: View {
    @Environment(\.themePalette) var themePalette
    let text: LocalizedStringKey

    var body: some View {
        PanelFootnote(text: text)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, SettingsMetrics.cardMargin)
            .padding(.bottom, SettingsMetrics.cardGap - Theme.PhonePanel.footnoteTop)
    }
}

/// A row in a settings card, the bot panel's row (#4101): 16 pt words 20 pt
/// from the card's edges, a one-line row 52 pt high, a two-line row 15.5 pt
/// above its title and under its muted 13 pt line, the chevron's ink 24 pt
/// from the trailing edge, a value 15 pt before it.
struct SettingsRow: View {
    @Environment(\.themePalette) var themePalette
    enum Accessory {
        case none
        case chevron
        case value(String)
        case valueChevron(String)
        case toggle(Binding<Bool>)
        case check
        case progress
        /// Opens outside the app: the north-east arrow.
        case external
    }

    enum Style { case normal, destructive, action }

    let title: LocalizedStringKey
    /// Typed text (a name a person wrote): shown as is, never read as a key.
    var verbatimTitle: String?
    /// English source text, looked up in the app's chosen language.
    var subtitle: String?
    var systemImage: String?
    var accessory: Accessory = .none
    var style: Style = .normal
    var identifier: String?
    /// A picture before the title (Switch Account: another account's photo).
    var leading: AnyView?
    /// What VoiceOver and UI tests read as the row's value.
    var accessibilityValueText: String?
    var action: (() -> Void)?

    private var titleColor: Color {
        switch style {
        case .normal: Theme.textPrimary
        case .destructive: Theme.destructive
        case .action: Theme.blue
        }
    }

    private var isToggle: Bool {
        if case .toggle = accessory { return true }
        return false
    }

    private var titleText: Text { verbatimTitle.map { Text(verbatim: $0) } ?? Text(title) }

    var body: some View {
        let row = HStack(alignment: subtitle == nil ? .center : .top, spacing: 0) {
            if let leading {
                leading.padding(.trailing, 10)
            }
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: systemImage == "trash" ? 17 : 19, weight: .light))
                    .foregroundStyle(titleColor)
                    .frame(width: SettingsMetrics.glyphColumn, alignment: .leading)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: SettingsMetrics.lineGap) {
                titleText
                    .font(SettingsMetrics.rowFont)
                    .foregroundStyle(titleColor)
                    .lineLimit(subtitle == nil ? 1 : 2)
                if let subtitle {
                    Text(verbatim: AppStrings.localized(subtitle))
                        .font(SettingsMetrics.subtitleFont)
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 12)
            trailing
                .frame(maxHeight: subtitle == nil || !isToggle ? .infinity : nil)
        }
        .padding(.leading, SettingsMetrics.rowInset)
        .padding(.trailing, trailingPadding)
        .padding(.vertical, subtitle == nil ? 0 : SettingsMetrics.twoLinePadding)
        .frame(minHeight: SettingsMetrics.row)
        .contentShape(Rectangle())

        if let action, !isToggle {
            Button {
                Haptics.selection()
                action()
            } label: { row }
            .buttonStyle(SettingsRowButtonStyle())
            .accessibilityIdentifier(identifier ?? "")
            .accessibilityValue(Text(verbatim: accessibilityValueText ?? ""))
        } else if isToggle {
            // The switch stays its own element, named after the row.
            row
        } else {
            row
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(identifier ?? "")
        }
    }

    private var trailingPadding: CGFloat {
        switch accessory {
        case .chevron, .valueChevron, .external: SettingsMetrics.chevronTrailing
        default: SettingsMetrics.trailingInset
        }
    }

    @ViewBuilder private var trailing: some View {
        switch accessory {
        case .none:
            EmptyView()
        case .chevron:
            SettingsChevron()
        case let .value(text):
            Text(verbatim: text).font(SettingsMetrics.rowFont).foregroundStyle(Theme.textSecondary).lineLimit(1)
        case let .valueChevron(text):
            HStack(spacing: SettingsMetrics.valueGap) {
                Text(verbatim: text).font(SettingsMetrics.rowFont).foregroundStyle(Theme.textSecondary).lineLimit(1)
                SettingsChevron()
            }
        case let .toggle(binding):
            Toggle("", isOn: binding)
                .labelsHidden()
                .toggleStyle(ParityToggleStyle(width: Theme.PhonePanel.switchSize.width, height: Theme.PhonePanel.switchSize.height))
                .accessibilityLabel(titleText)
                .accessibilityIdentifier((identifier ?? "") + ".toggle")
        case .check:
            Image(systemName: "checkmark")
                .font(.system(size: 17, weight: .regular))
                .foregroundStyle(Theme.textPrimary)
        case .progress:
            ProgressView().controlSize(.small).tint(Theme.textSecondary)
        case .external:
            Image(systemName: "arrow.up.right")
                .font(.system(size: 17, weight: .light))
                .foregroundStyle(Theme.chevron)
                .accessibilityHidden(true)
        }
    }
}

/// The row's chevron: the bot panel's (#4101).
struct SettingsChevron: View {
    var body: some View { ProfileChevron() }
}

/// A row press shows as a faint lift instead of the system's grey flash.
struct SettingsRowButtonStyle: ButtonStyle {
    @Environment(\.themePalette) var themePalette
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Theme.parity(Color.white.opacity(0.06), Theme.textPrimary.opacity(0.06)) : Color.clear)
    }
}

/// The person's photo (Session.accountPhoto, AccountPhotoStore), else their
/// initial.
struct AccountPhoto: View {
    @Environment(\.themePalette) var themePalette
    let photo: UIImage?
    let name: String
    var size: CGFloat = 38.5

    var body: some View {
        Group {
            if let photo {
                Image(uiImage: photo).resizable().scaledToFill()
            } else {
                // the app's one initials avatar, muted as the reference
                // draws it (#4103)
                PersonAvatar(initials: People.initials(name), size: size, muted: true)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

/// The person's row (#4103): an 89 pt row, the 42 pt round photo or
/// initials 20 pt into the card, the name in 16 pt and the lines under it
/// (mail, organization) in muted 13 pt, an optional chevron.
struct AccountCardRow: View {
    @Environment(\.themePalette) var themePalette
    let name: String
    let detail: String?
    let photo: UIImage?
    var chevron = false
    var action: (() -> Void)?

    var body: some View {
        let row = HStack(spacing: 0) {
            AccountPhoto(photo: photo, name: name, size: CGFloat(PhoneSheetMetrics.avatar))
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: name)
                    .font(SettingsMetrics.rowFont)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                if let detail {
                    Text(verbatim: detail)
                        .font(SettingsMetrics.subtitleFont)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                }
            }
            .padding(.leading, CGFloat(PhoneSheetMetrics.avatarGap))
            Spacer(minLength: 12)
            if chevron { SettingsChevron() }
        }
        .padding(.leading, SettingsMetrics.rowInset)
        .padding(.trailing, chevron ? SettingsMetrics.chevronTrailing : SettingsMetrics.trailingInset)
        .frame(minHeight: SettingsMetrics.personRow)
        .contentShape(Rectangle())

        if let action {
            Button {
                Haptics.selection()
                action()
            } label: { row }
            .buttonStyle(SettingsRowButtonStyle())
            .accessibilityIdentifier("settings-account")
            .accessibilityValue(Text(verbatim: photo == nil ? "" : "photo"))
        } else {
            row.accessibilityElement(children: .combine)
                .accessibilityIdentifier("account-card")
                .accessibilityValue(Text(verbatim: photo == nil ? "" : "photo"))
        }
    }
}

// MARK: - Sheets the rows open

/// A web page in SFSafariViewController.
struct SafariSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let controller = SFSafariViewController(url: url)
        controller.preferredControlTintColor = UIColor(Theme.textPrimary)
        controller.preferredBarTintColor = UIColor(Theme.bg)
        return controller
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

/// Mail compose to support; `done` runs when it closes.
struct MailComposeSheet: UIViewControllerRepresentable {
    let recipient: String
    let subject: String
    let body: String
    let done: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(done: done) }

    func makeUIViewController(context: Context) -> MFMailComposeViewController {
        let controller = MFMailComposeViewController()
        controller.mailComposeDelegate = context.coordinator
        controller.setToRecipients([recipient])
        controller.setSubject(subject)
        controller.setMessageBody(body, isHTML: false)
        return controller
    }

    func updateUIViewController(_ controller: MFMailComposeViewController, context: Context) {}

    final class Coordinator: NSObject, MFMailComposeViewControllerDelegate {
        let done: () -> Void
        init(done: @escaping () -> Void) { self.done = done }

        func mailComposeController(_ controller: MFMailComposeViewController, didFinishWith result: MFMailComposeResult, error: Error?) {
            done()
        }
    }
}

/// Where the link rows go. Pulsatrix pages, in French for a French app.
enum SettingsLinks {
    static let supportEmail = "hello@pulsatrix.ca"

    private static func page(_ path: String, french: Bool) -> URL {
        URL(string: "https://pulsatrix.ca/\(french ? "fr/" : "")\(path)")!
    }

    static func helpCenter(french: Bool) -> URL { page("docs", french: false) }
    /// The app's own privacy policy, the URL given to App Store Connect.
    static func privacy(french: Bool) -> URL { URL(string: "https://github.com/pulsatrixtechnologies/sagax/blob/main/docs/ios-privacy.md")! }
    static func terms(french: Bool) -> URL { page("terms", french: french) }
    /// The app's own terms: its license and use terms in the source repository.
    static let sagaxTerms = URL(string: "https://github.com/pulsatrixtechnologies/sagax/blob/main/LICENSING.md")!
}

/// Scrolls the enclosing UIScrollView to an exact offset once: the parity
/// harness's "14-settings-bottom" position.
struct ScrollOffsetSetter: UIViewRepresentable {
    let offset: CGFloat

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        view.isUserInteractionEnabled = false
        // Rows arrive as the sheet's reads finish: set it again after each.
        for delay in [0.6, 1.5, 2.5, 4.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak view] in
                var candidate: UIView? = view?.superview
                while let current = candidate, !(current is UIScrollView) { candidate = current.superview }
                guard let scroll = candidate as? UIScrollView else { return }
                let maxY = max(0, scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom)
                scroll.setContentOffset(CGPoint(x: 0, y: min(offset, maxY) - scroll.adjustedContentInset.top), animated: false)
            }
        }
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {}
}

/// Tells when the person starts dragging the scroll view it sits in, so a
/// list that settles itself while it opens stops as soon as it is theirs.
/// It watches the scroll view's own pan: no gesture of its own competes
/// with the scroll.
struct ScrollDragProbe: UIViewRepresentable {
    let onDrag: () -> Void

    func makeUIView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.isUserInteractionEnabled = false
        view.onDrag = onDrag
        return view
    }

    func updateUIView(_ view: ProbeView, context: Context) {
        view.onDrag = onDrag
    }

    final class ProbeView: UIView {
        var onDrag: (() -> Void)?
        private weak var scroll: UIScrollView?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            var view = superview
            while let current = view, !(current is UIScrollView) { view = current.superview }
            guard let found = view as? UIScrollView, found !== scroll else { return }
            scroll?.panGestureRecognizer.removeTarget(self, action: #selector(panned(_:)))
            found.panGestureRecognizer.addTarget(self, action: #selector(panned(_:)))
            scroll = found
        }

        @objc private func panned(_ pan: UIPanGestureRecognizer) {
            if pan.state == .began { onDrag?() }
        }
    }
}

// MARK: - Text

/// The app's own strings in the language chosen in Settings (or the
/// system's), for the places that need a `String` rather than a `Text`.
enum AppStrings {
    static func localized(_ key: String) -> String {
        let stored = UserDefaults.standard.string(forKey: PrefKey.language) ?? AppLanguage.system.rawValue
        if let code = AppLanguage.resolved(stored).locale?.identifier,
           let path = Bundle.main.path(forResource: code, ofType: "lproj"),
           let bundle = Bundle(path: path) {
            return bundle.localizedString(forKey: key, value: key, table: nil)
        }
        return Bundle.main.localizedString(forKey: key, value: key, table: nil)
    }
}

// MARK: - Legacy grouped screens

/// The earlier Form and List screens in the active skin: the skin's ground
/// behind the groups, its card under every row, its ink as the default text.
/// A later pass restyles these screens; until then they stay token-based.
struct ThemedListChrome: ViewModifier {
    @Environment(\.themePalette) var themePalette

    func body(content: Content) -> some View {
        content
            .scrollContentBackground(.hidden)
            .background(Theme.bg.ignoresSafeArea())
            .foregroundStyle(Theme.textPrimary)
    }
}

extension View {
    func themedListChrome() -> some View { modifier(ThemedListChrome()) }
}

/// `Form { }` with the skin's row background on every row (a Group hands
/// its modifiers to each section it holds).
struct ThemedForm<Content: View>: View {
    @Environment(\.themePalette) var themePalette
    @ViewBuilder let content: () -> Content

    var body: some View {
        Form {
            Group(content: content).listRowBackground(Theme.card)
        }
        .themedListChrome()
    }
}

/// `List { }` with the skin's row background on every row.
struct ThemedList<Content: View>: View {
    @Environment(\.themePalette) var themePalette
    @ViewBuilder let content: () -> Content

    var body: some View {
        List {
            Group(content: content).listRowBackground(Theme.card)
        }
        .themedListChrome()
    }
}
