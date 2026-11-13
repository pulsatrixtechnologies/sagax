// The iPhone bot panel's grouped rows as the reference app draws them (#4101):
// a card at the page margin, rows with a leading outline icon, the label, a
// muted value and a chevron, a hairline that starts at the label; a muted
// group title and a footnote at the rows' text inset. The measures are
// `PhonePanelMetrics` (CompanionCore). The column that holds them takes the
// side margin once (`profileColumn`), so no card pads itself again.
import CompanionCore
import SwiftUI

extension Theme {
    /// `PhonePanelMetrics` as points.
    enum PhonePanel {
        static let margin = CGFloat(PhonePanelMetrics.margin)
        static let barCentre = CGFloat(PhonePanelMetrics.barCentre)
        static let barGap = CGFloat(PhonePanelMetrics.barGap)
        static let mascot = CGFloat(PhonePanelMetrics.mascot)
        static let mascotTop = CGFloat(PhonePanelMetrics.mascotTop)
        static let nameTop = CGFloat(PhonePanelMetrics.nameTop)
        static let pillTop = CGFloat(PhonePanelMetrics.pillTop)
        static let pillHeight = CGFloat(PhonePanelMetrics.pillHeight)
        static let pillPadding = CGFloat(PhonePanelMetrics.pillPadding)
        static let headerToCard = CGFloat(PhonePanelMetrics.headerToCard)
        static let groupGap = CGFloat(PhonePanelMetrics.groupGap)
        static let row = CGFloat(PhonePanelMetrics.row)
        static let iconCentre = CGFloat(PhonePanelMetrics.iconCentre)
        static let textColumn = CGFloat(PhonePanelMetrics.textColumn)
        static let chevronTrailing = CGFloat(PhonePanelMetrics.chevronTrailing)
        static let textInset = CGFloat(PhonePanelMetrics.textInset)
        static let switchRow = CGFloat(PhonePanelMetrics.switchRow)
        static let titleToCard = CGFloat(PhonePanelMetrics.titleToCard)
        static let footnoteTop = CGFloat(PhonePanelMetrics.footnoteTop)
        static let switchSize = CGSize(width: PhonePanelMetrics.switchWidth, height: PhonePanelMetrics.switchHeight)
        static let chipHeight = CGFloat(PhonePanelMetrics.chipHeight)
        static let chipGap = CGFloat(PhonePanelMetrics.chipGap)
        static let chipPadding = CGFloat(PhonePanelMetrics.chipPadding)
        static let listRow = CGFloat(PhonePanelMetrics.listRow)
        static let thumbnail = CGFloat(PhonePanelMetrics.thumbnail)
        static let thumbnailLeading = CGFloat(PhonePanelMetrics.thumbnailLeading)
        static let listTextColumn = CGFloat(PhonePanelMetrics.listTextColumn)
        static let showMoreGap = CGFloat(PhonePanelMetrics.showMoreGap)
        static let cardOutline = CGFloat(PhonePanelMetrics.cardOutline)
        static let glyph = CGFloat(PhonePanelMetrics.glyph)

        static var name: SwiftUI.Font { Theme.font(CGFloat(PhonePanelMetrics.nameSize), .semibold) }
        static var rowFont: SwiftUI.Font { Theme.font(CGFloat(PhonePanelMetrics.rowSize)) }
        static var titleFont: SwiftUI.Font { Theme.font(CGFloat(PhonePanelMetrics.titleSize)) }
        static var subtitleFont: SwiftUI.Font { Theme.font(CGFloat(PhonePanelMetrics.subtitleSize)) }
        static var pillFont: SwiftUI.Font { Theme.font(15, .medium) }
        static var chipFont: SwiftUI.Font { Theme.font(CGFloat(PhonePanelMetrics.chipTextSize), .medium) }
        static var titleBarFont: SwiftUI.Font { Theme.font(CGFloat(PhonePanelMetrics.rowSize), .medium) }
    }
}

extension View {
    /// The panel's column and every page pushed from it: one side margin.
    func phonePanelColumn() -> some View {
        profileColumn(margin: Theme.PhonePanel.margin).environment(\.profileCardOutlined, true)
    }
}

/// "Configure bot": the muted title over a group, at the rows' text inset.
struct PanelGroupTitle: View {
    @Environment(\.themePalette) var themePalette
    let text: LocalizedStringKey

    var body: some View {
        Text(text)
            .font(Theme.PhonePanel.titleFont)
            .foregroundStyle(Theme.textTertiary)
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, Theme.PhonePanel.textInset)
            .padding(.bottom, Theme.PhonePanel.titleToCard)
            .accessibilityAddTraits(.isHeader)
    }
}

/// The muted sentence under a card, at the rows' text inset.
struct PanelFootnote: View {
    @Environment(\.themePalette) var themePalette
    let text: LocalizedStringKey

    var body: some View {
        Text(text)
            .font(Theme.PhonePanel.titleFont)
            .foregroundStyle(Theme.textTertiary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Theme.PhonePanel.textInset)
            .padding(.top, Theme.PhonePanel.footnoteTop)
    }
}

/// The hairline between two rows, from the label to the card's edge.
struct PanelRowDivider: View {
    @Environment(\.themePalette) var themePalette
    var leading: CGFloat = Theme.PhonePanel.textColumn

    var body: some View {
        Rectangle().fill(Theme.hairline).frame(height: 1).padding(.leading, leading)
    }
}

/// One row that pushes a page: the outline icon, the label, the muted value
/// and the chevron.
struct PanelNavRow: View {
    @Environment(\.themePalette) var themePalette
    let systemImage: String
    /// A drawn mark in place of the symbol, when no SF symbol matches the
    /// reference's (Library: a folder with books).
    var glyph: AnyShape? = nil
    let title: Text
    var value: Text? = nil
    let id: String
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            HStack(spacing: 0) {
                icon
                    // centred 33 pt in; the label still starts 57 pt in
                    .frame(width: Theme.PhonePanel.iconCentre * 2)
                    .frame(width: Theme.PhonePanel.textColumn, alignment: .leading)
                    .accessibilityHidden(true)
                title
                    .font(Theme.PhonePanel.rowFont)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 12)
                if let value {
                    value
                        .font(Theme.PhonePanel.rowFont)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .padding(.trailing, 10)
                }
                ProfileChevron()
                    .padding(.trailing, Theme.PhonePanel.chevronTrailing)
            }
            .frame(height: Theme.PhonePanel.row)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(id)
    }

    @ViewBuilder
    private var icon: some View {
        if let glyph {
            glyph
                .fill(Theme.iconGrey)
                .frame(width: Theme.PhonePanel.glyph, height: Theme.PhonePanel.glyph)
        } else {
            Image(systemName: systemImage)
                // the reference draws thin outline icons
                .font(.system(size: 18, weight: .light))
                .foregroundStyle(Theme.iconGrey)
        }
    }
}

/// The reference's Library mark: a folder outline whose lower right corner
/// holds two upright books and a leaning one. No SF symbol draws it
/// ("books.vertical" is the books alone), so it is drawn on a 24 pt grid.
struct LibraryFolderGlyph: Shape {
    var lineWidth: CGFloat = 1.2

    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 24
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * s, y: rect.minY + y * s) }
        let r: CGFloat = 1.6
        var path = Path()
        // folder: from the bottom edge (stopping short of the books) up the
        // left side, along the tab, down its slope and across to the right
        path.move(to: p(9.4, 19))
        path.addLine(to: p(1.6 + r, 19))
        path.addQuadCurve(to: p(1.6, 19 - r), control: p(1.6, 19))
        path.addLine(to: p(1.6, 2.6 + r))
        path.addQuadCurve(to: p(1.6 + r, 2.6), control: p(1.6, 2.6))
        path.addLine(to: p(10.4, 2.6))
        path.addLine(to: p(12.4, 5.4))
        path.addLine(to: p(21.2 - r, 5.4))
        path.addQuadCurve(to: p(21.2, 5.4 + r), control: p(21.2, 5.4))
        path.addLine(to: p(21.2, 8.4))
        // books
        path.move(to: p(13.4, 11.8))
        path.addLine(to: p(13.4, 20.6))
        path.move(to: p(16.8, 11.8))
        path.addLine(to: p(16.8, 20.6))
        path.move(to: p(19.4, 11.8))
        path.addLine(to: p(22.2, 20.6))
        return path.strokedPath(StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
    }
}

/// A switch row without an icon (Notifications), text and switch at the
/// card's text inset.
struct PanelSwitchRow: View {
    @Environment(\.themePalette) var themePalette
    let title: Text
    @Binding var isOn: Bool
    let id: String

    var body: some View {
        HStack(spacing: 12) {
            title
                .font(Theme.PhonePanel.rowFont)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
            Spacer(minLength: 0)
            Toggle("", isOn: $isOn)
                .labelsHidden()
                .toggleStyle(ParityToggleStyle(width: Theme.PhonePanel.switchSize.width, height: Theme.PhonePanel.switchSize.height))
        }
        .padding(.horizontal, Theme.PhonePanel.textInset)
        .frame(height: Theme.PhonePanel.switchRow)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(id)
    }
}

/// A filter chip of the phone's pages (Library, Connect apps): the chosen
/// one white on the page, the others on the raised colour (#4101, #4103).
struct PhoneChip: View {
    @Environment(\.themePalette) var themePalette
    let title: Text
    let selected: Bool
    let id: String
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            withAnimation(.snappy(duration: 0.2)) { action() }
        } label: {
            title
                .font(Theme.PhonePanel.chipFont)
                .foregroundStyle(selected ? Theme.bg : Theme.textPrimary)
                .lineLimit(1)
                .padding(.horizontal, Theme.PhonePanel.chipPadding)
                .frame(height: Theme.PhonePanel.chipHeight)
                .background(selected ? Theme.textPrimary : Theme.cardRaised, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
        .accessibilityIdentifier(id)
    }
}

/// The small "Edit" pill under the bot's name.
struct PanelEditPill: View {
    @Environment(\.themePalette) var themePalette
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            Text("Edit")
                .font(Theme.PhonePanel.pillFont)
                .foregroundStyle(Theme.textPrimary)
                .padding(.horizontal, Theme.PhonePanel.pillPadding)
                .frame(height: Theme.PhonePanel.pillHeight)
                .background(Theme.cardRaised, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("panel-edit")
    }
}

// MARK: - Page bar

/// How far a pushed page's content has scrolled under its bar.
private struct PhonePageScrollKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

/// The bar of a page pushed from the panel as the reference draws it
/// (#4101): the round back control at the top left on the page margin,
/// centred 31 pt under the safe area, the title centred in 16 pt medium;
/// clear over the page, a material that blurs the list once it scrolls
/// under. The leading control is always top left, actions top right.
struct PhonePageBar: View {
    @Environment(\.themePalette) var themePalette
    let title: Text
    let scrolled: Bool
    let back: () -> Void

    var body: some View {
        ZStack {
            title
                .font(Theme.PhonePanel.titleBarFont)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .padding(.horizontal, Theme.PhonePanel.margin + Theme.Metric.glassLarge + 8)
                .accessibilityAddTraits(.isHeader)
            HStack(spacing: 0) {
                ProfileBackButton(action: back)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, Theme.PhonePanel.margin)
        }
        .frame(height: Theme.PhonePanel.barCentre * 2)
        .frame(maxWidth: .infinity)
        .background {
            Rectangle()
                .fill(.ultraThinMaterial)
                .opacity(scrolled ? 1 : 0)
                .ignoresSafeArea(edges: .top)
                .animation(.easeOut(duration: 0.15), value: scrolled)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("phone-page-bar")
    }
}

extension View {
    /// A page pushed from the phone panel: our bar instead of the system
    /// one, so the back control and the title sit where the reference puts
    /// them; the swipe back still works.
    func phonePageBar(_ title: Text, back: @escaping () -> Void) -> some View {
        modifier(PhonePageBarModifier(title: title, back: back))
    }

    /// Marks the top of a page's scrolled content for `phonePageBar`.
    func phonePageScrollMarker() -> some View {
        background(alignment: .top) {
            GeometryReader { proxy in
                Color.clear.preference(key: PhonePageScrollKey.self, value: proxy.frame(in: .named("phone-page")).minY)
            }
            .frame(height: 0)
        }
    }
}

private struct PhonePageBarModifier: ViewModifier {
    let title: Text
    let back: () -> Void
    @State private var scrolled = false

    func body(content: Content) -> some View {
        content
            .coordinateSpace(name: "phone-page")
            .onPreferenceChange(PhonePageScrollKey.self) { minY in
                let under = minY < -1
                if under != scrolled { scrolled = under }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                PhonePageBar(title: title, scrolled: scrolled, back: back)
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationBarBackButtonHidden(true)
            .background(SwipeBackBridge())
    }
}
