// Building blocks of the Settings card sheet (iOS parity 12, 14, 15, 16, 21),
// at the measured geometry of measure-settings.md. Theme.swift holds the
// shared tokens; these parts are specific to the sheet's pages: the page
// frame with its glass header, the grouped card rows, and the safari and
// mail sheets the link rows open.
import MessageUI
import SafariServices
import SwiftUI
import UIKit

enum SettingsMetrics {
    /// Glass circle: 17.33 pt in from the sheet's left and top edges.
    static let headerInset: CGFloat = 17.33
    /// First card top, from the sheet top (213.84 - 123.67).
    static let firstCardTop: CGFloat = 90.17
    /// Title ink starts 16.67 pt after the circle (x 84 on screen).
    static let titleGap: CGFloat = 15.67
    static let cardMargin: CGFloat = 15.17
    static let rowInset: CGFloat = 17.5
    static let trailingInset: CGFloat = 17.2
    /// Chevron ink ends 21.2 pt before the card's trailing edge.
    static let chevronTrailing: CGFloat = 21.17
    static let cardGap: CGFloat = 27
    /// Previous card bottom to the next card top when a label sits between.
    static let labelledGap: CGFloat = 48.67
    static let footerGap: CGFloat = 30.3
    /// The references set 13.5 pt text about 1% tighter than SwiftUI does.
    static let tracking135: CGFloat = -0.05
    /// The sheet's top corners (Grok Bot's account sheet).
    static let sheetRadius: CGFloat = 38
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
                        .topScrollEdgeFade(height: 78, background: background)
                } else {
                    stack
                }
            }
            .clipShape(SettingsSheetShape())
            header
        }
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

    /// Grok Bot's sheet header (2026-11-01): the round X or back at the
    /// leading corner, the title centred on the screen, a trailing control.
    private var header: some View {
        ZStack {
            HStack(spacing: 0) {
                switch leading {
                case let .close(action):
                    GlassCircleButton(systemImage: "xmark", size: .sheet, accessibilityLabel: "Close", action: action)
                        .accessibilityIdentifier("settings-close")
                case .back:
                    GlassCircleButton(systemImage: "chevron.left", size: .sheet, accessibilityLabel: "Back", glyphOffset: CGSize(width: 1, height: 0)) {
                        if let settingsPop { settingsPop() } else { dismiss() }
                    }
                        .accessibilityIdentifier("settings-back")
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
                    .font(Theme.Font.headerTitle)
                    .tracking(SettingsMetrics.tracking135)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                    .padding(.horizontal, GlassCircleButton.Size.sheet.rawValue + 20)
                    .allowsHitTesting(false)
                    .accessibilityAddTraits(.isHeader)
            }
        }
        .padding(.leading, SettingsMetrics.headerInset)
        .padding(.trailing, SettingsMetrics.headerInset)
        .padding(.top, SettingsMetrics.headerInset)
    }
}

/// The sheet's shape: Grok Bot's card sheet, rounded at the top and
/// running past the bottom edge.
struct SettingsSheetShape: Shape {
    func path(in rect: CGRect) -> Path {
        Path(roundedRect: CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: rect.height + 80),
             cornerRadius: SettingsMetrics.sheetRadius, style: .continuous)
    }
}

/// Behind every Settings page: the dimmed strip under the status bar and
/// the sheet itself, as Grok Bot presents its account sheet (2026-11-01).
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

/// A grouped card at the sheet's margins (x 23.17 to 378.5 on screen).
struct SettingsCard<Content: View>: View {
    @Environment(\.themePalette) var themePalette
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0, content: content)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
            // Grok Bot's cards carry a hairline edge (2026-11-01)
            .overlay(RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
            .padding(.horizontal, SettingsMetrics.cardMargin)
    }
}

/// The grey 11 pt label above a card ("Bot", "Switch Account"): card bottom
/// to label cap top 30.2, label baseline to card top 10.5.
struct SettingsSectionLabel: View {
    @Environment(\.themePalette) var themePalette
    let text: LocalizedStringKey

    var body: some View {
        Text(text)
            .font(Theme.Font.label)
            .foregroundStyle(Theme.textTertiary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 32.67)
            .padding(.bottom, 7.85)
            .frame(height: SettingsMetrics.labelledGap, alignment: .bottom)
    }
}

/// The grey explanation under a card: cap top 10.7 below it, 14 pt lines.
struct SettingsFooter: View {
    @Environment(\.themePalette) var themePalette
    let text: LocalizedStringKey

    var body: some View {
        Text(text)
            .font(Theme.Font.label)
            .foregroundStyle(Theme.textTertiary)
            .lineSpacing(0.87)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 32.67)
            .padding(.trailing, 30)
            .padding(.top, 8)
            .padding(.bottom, 27.65)
    }
}

/// A row in a settings card. Heights are the measured ones; the title and
/// subtitle sit at the reference's baselines, a toggle tops out at +13.8 in
/// a two-line row and is centred otherwise.
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
    /// English source text, looked up in the app's chosen language.
    var subtitle: String?
    var systemImage: String?
    var accessory: Accessory = .none
    var style: Style = .normal
    var height: CGFloat?
    var identifier: String?
    /// Title top inside a two-line row (the references differ by a point
    /// between rows).
    var textTop: CGFloat = 14.37
    /// A picture before the title (Switch Account: each account's photo).
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

    private var isNone: Bool {
        if case .none = accessory { return true }
        return false
    }

    private var isToggle: Bool {
        if case .toggle = accessory { return true }
        return false
    }

    var body: some View {
        let row = Group {
            if let subtitle {
                twoLine(subtitle)
            } else {
                oneLine
            }
        }
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

    private var oneLine: some View {
        HStack(spacing: 0) {
            if let leading {
                leading.padding(.trailing, 10)
            }
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: systemImage == "trash" ? 15.5 : 17.8, weight: .regular))
                    .foregroundStyle(titleColor)
                    .frame(width: 18, alignment: .leading)
                    .padding(.trailing, 9)
            }
            Text(title)
                .font(Theme.Font.rowTitle)
                .tracking(SettingsMetrics.tracking135)
                .foregroundStyle(titleColor)
                .lineLimit(1)
            Spacer(minLength: 12)
            trailing
        }
        // Centred text sits a pixel low against the references.
        .offset(y: isToggle ? 0 : -0.33)
        .padding(.leading, SettingsMetrics.rowInset)
        .padding(.trailing, trailingPadding)
        .frame(height: height ?? (isToggle ? Theme.Metric.toggleRowHeight : 43.5))
    }

    private func twoLine(_ subtitle: String) -> some View {
        // The text column runs to a fixed gap before the control, whatever
        // the control's own sizing says, so lines wrap where the
        // reference's do.
        VStack(alignment: .leading, spacing: 2.3) {
            Text(title)
                .font(Theme.Font.rowTitle)
                .tracking(SettingsMetrics.tracking135)
                .foregroundStyle(titleColor)
            WrappingLabel(text: AppStrings.localized(subtitle), size: 11, color: UIColor(Theme.textSecondary), lineHeight: 14)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, textTop)
        .padding(.bottom, 14)
        .padding(.leading, SettingsMetrics.rowInset)
        .padding(.trailing, trailingPadding + trailingReserve)
        .frame(height: height, alignment: .top)
        .frame(minHeight: height == nil ? Theme.Metric.subtitleRowHeight : nil, alignment: .top)
        .overlay(alignment: isToggle ? .topTrailing : .trailing) {
            trailing
                .padding(.top, isToggle ? 13.8 : 0)
                .padding(.trailing, trailingPadding)
        }
    }

    /// Room kept for the trailing control beside two-line text.
    private var trailingReserve: CGFloat {
        switch accessory {
        case .none: 0
        case .toggle: 60.33 + 4
        case .progress: 28
        default: 40
        }
    }

    private var trailingPadding: CGFloat {
        switch accessory {
        case .chevron, .valueChevron, .external: SettingsMetrics.chevronTrailing - 4
        case .check: 16.5
        case .value: 17.83
        case .none: 16
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
            Text(verbatim: text).font(Theme.Font.rowTitle).tracking(SettingsMetrics.tracking135).foregroundStyle(Theme.textSecondary).lineLimit(1)
        case let .valueChevron(text):
            HStack(spacing: 11.67) {
                Text(verbatim: text).font(Theme.Font.rowTitle).tracking(SettingsMetrics.tracking135).foregroundStyle(Theme.textSecondary).lineLimit(1)
                SettingsChevron()
            }
        case let .toggle(binding):
            Toggle("", isOn: binding)
                .labelsHidden()
                .toggleStyle(ParityToggleStyle())
                .accessibilityLabel(Text(title))
                .accessibilityIdentifier((identifier ?? "") + ".toggle")
        case .check:
            Image(systemName: "checkmark")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.textPrimary)
        case .progress:
            ProgressView().controlSize(.small).tint(Theme.textSecondary)
        case .external:
            Image(systemName: "arrow.up.right")
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(Theme.chevron)
                .padding(.trailing, 1)
                .accessibilityHidden(true)
        }
    }
}

/// `chevron.right` in #6B6A6D: ink 6.67 x 11.67.
struct SettingsChevron: View {
    @Environment(\.themePalette) var themePalette
    var body: some View {
        Image(systemName: "chevron.right")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Theme.chevron)
            .padding(.trailing, 3.67)
    }
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
                ProfileAvatar(name: name, size: size)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

/// The profile row (65.33): photo, name over email, optional chevron.
struct AccountCardRow: View {
    @Environment(\.themePalette) var themePalette
    let name: String
    let detail: String?
    let photo: UIImage?
    var chevron = false
    var action: (() -> Void)?

    var body: some View {
        let row = HStack(spacing: 0) {
            AccountPhoto(photo: photo, name: name)
            VStack(alignment: .leading, spacing: 1.2) {
                Text(verbatim: name)
                    .font(Theme.Font.rowTitle)
                    .tracking(SettingsMetrics.tracking135)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                if let detail {
                    Text(verbatim: detail)
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
            }
            .padding(.leading, 9.8)
            Spacer(minLength: 12)
            if chevron { SettingsChevron() }
        }
        .padding(.leading, SettingsMetrics.rowInset)
        .padding(.trailing, SettingsMetrics.chevronTrailing - 4)
        .frame(height: 65.33)
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

/// Multi-line text that wraps greedily, as UIKit labels do. SwiftUI's
/// `Text` moves a word down to avoid a one-word last line, which the
/// references do not.
struct WrappingLabel: UIViewRepresentable {
    let text: String
    let size: CGFloat
    let color: UIColor
    /// Baseline to baseline.
    let lineHeight: CGFloat

    func makeUIView(context: Context) -> UILabel {
        let label = UILabel()
        label.numberOfLines = 0
        label.lineBreakMode = .byWordWrapping
        label.lineBreakStrategy = []
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        label.adjustsFontForContentSizeCategory = false
        return label
    }

    func updateUIView(_ label: UILabel, context: Context) {
        let style = NSMutableParagraphStyle()
        style.lineBreakMode = .byWordWrapping
        style.lineBreakStrategy = []
        style.minimumLineHeight = lineHeight
        style.maximumLineHeight = lineHeight
        let font = UIFont.systemFont(ofSize: size)
        // Keep the first baseline where a plain label puts it.
        let shift = (lineHeight - font.lineHeight) / 2
        label.attributedText = NSAttributedString(string: text, attributes: [
            .font: font, .foregroundColor: color, .paragraphStyle: style, .baselineOffset: shift > 0 ? 0 : 0,
        ])
        label.accessibilityLabel = text
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView label: UILabel, context: Context) -> CGSize? {
        let width = proposal.width ?? 300
        let fitted = label.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: ceil(fitted.height * 3) / 3)
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
