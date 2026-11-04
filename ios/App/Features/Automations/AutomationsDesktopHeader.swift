// The iPad desktop shell's page header (src/components/content-page.tsx):
// `PageHeader` (the title with its 18 pt icon, "› section", the page's own
// controls next to it, the right group), `PageSegment`, `PageFilters`,
// `PageMenu` with its small count, and the 36 pt header buttons. The
// header folds as the desktop's container queries do: under 60rem (960 pt)
// the segment's labels and Filters' label hide behind their icons, under
// 44rem (704 pt) the page's controls take a second line.
import SwiftUI

/// The Automations page column's width (the iPad desktop shell measures it).
private struct AutomationsPageWidthKey: EnvironmentKey { static let defaultValue: CGFloat = 1100 }
extension EnvironmentValues {
    var automationsPageWidth: CGFloat {
        get { self[AutomationsPageWidthKey.self] }
        set { self[AutomationsPageWidthKey.self] = newValue }
    }
}

/// What the header's width allows (`@container/page-header`).
struct DesktopHeaderFit: Equatable {
    /// Under 60rem: icon-only segment and Filters.
    var folded = false
    /// Under 44rem: the page's controls on their own line.
    var stacked = false

    init(width: CGFloat) {
        folded = width < 960
        stacked = width < 704
    }

    init() {}
}

struct DesktopHeaderWidthKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// `PageHeader`: py-3, pl-6, pr-4, a hairline under it.
struct DesktopContentPageHeader<Primary: View, Actions: View>: View {
    @Environment(\.desktopTheme) private var theme
    let icon: DesktopIcon
    let title: LocalizedStringKey
    var section: LocalizedStringKey?
    @ViewBuilder var primary: (DesktopHeaderFit) -> Primary
    @ViewBuilder var actions: (DesktopHeaderFit) -> Actions
    /// The column's width, measured by the page around the header.
    var width: CGFloat = 1100

    var body: some View {
        let fit = DesktopHeaderFit(width: width)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                titleRow
                if !fit.stacked { primary(fit) }
                Spacer(minLength: 0)
                HStack(spacing: 6) { actions(fit) }
            }
            if fit.stacked {
                HStack(spacing: 8) { primary(fit) }
            }
        }
        .padding(.vertical, 12)
        .padding(.leading, 24)
        .padding(.trailing, 16)
        .frame(maxWidth: .infinity, alignment: .leading)

        .background(theme.app)
        .overlay(alignment: .bottom) { Rectangle().fill(theme.hairline.opacity(0.5)).frame(height: 0.5) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-page-header")
    }

    private var titleRow: some View {
        HStack(spacing: 8) {
            DesktopIconView(icon: icon, size: 18)
                .foregroundStyle(theme.inkSecondary)
            Text(title)
                .font(theme.font(16, .medium))
                .foregroundStyle(theme.ink)
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
            if let section {
                HStack(spacing: 4) {
                    DesktopIconView(icon: .chevronRight, size: 14)
                    Text(section).font(theme.font(16)).lineLimit(1)
                }
                .foregroundStyle(theme.inkSecondary)
                .accessibilityIdentifier("desktop-page-section")
            }
        }
        .fixedSize()
    }
}

/// `PageSegment`: rounded-lg, a hairline/50 border, the panel's fill, p-0.5.
struct DesktopPageSegment<Value: Hashable>: View {
    @Environment(\.desktopTheme) private var theme
    let label: LocalizedStringKey
    let value: Value
    let options: [(value: Value, label: LocalizedStringKey, icon: DesktopIcon, id: String)]
    var folded = false
    let choose: (Value) -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.id) { option in
                let on = option.value == value
                Button { choose(option.value) } label: {
                    HStack(spacing: 6) {
                        DesktopIconView(icon: option.icon, size: 14)
                        if !folded { Text(option.label).font(theme.font(12)).lineLimit(1) }
                    }
                    .foregroundStyle(on ? theme.ink : theme.inkSecondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 6).fill(on ? theme.raised : Color.clear))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(option.label))
                .accessibilityAddTraits(on ? .isSelected : [])
                .accessibilityIdentifier(option.id)
            }
        }
        .padding(2)
        .background(RoundedRectangle(cornerRadius: 8).fill(theme.panel))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
        .fixedSize()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(label))
    }
}

/// `PAGE_HEADER_BUTTON`: the 36 pt circle (border hairline-weak, the
/// elevated fill); a labelled one is a pill (px-3, gap-1.5).
struct DesktopHeaderButtonLabel<Content: View>: View {
    @Environment(\.desktopTheme) private var theme
    var labelled = false
    var accent = false
    @ViewBuilder var content: () -> Content

    var body: some View {
        HStack(spacing: 6) { content() }
            .font(theme.font(12, .medium))
            .foregroundStyle(accent ? Color.white : theme.ink)
            .padding(.horizontal, labelled ? 12 : 0)
            .frame(minWidth: 36, minHeight: 36, maxHeight: 36)
            .background(Capsule().fill(accent ? theme.accent : theme.elevated))
            .overlay(Capsule().strokeBorder(accent ? Color.clear : theme.hairlineWeak, lineWidth: 1))
            .contentShape(Capsule())
    }
}

/// `PageFilters`' button: the sliders, "Filters" from 60rem, and the count
/// of what narrows the page.
struct DesktopFiltersLabel: View {
    @Environment(\.desktopTheme) private var theme
    var folded = false
    var activeCount = 0

    var body: some View {
        let labelled = !folded || activeCount > 0
        DesktopHeaderButtonLabel(labelled: labelled) {
            DesktopIconView(icon: .slidersHorizontal, size: 15)
            if !folded { Text("Filters") }
            if activeCount > 0 {
                Text(verbatim: "\(activeCount)")
                    .font(theme.font(11, .semibold))
                    .foregroundStyle(Color.white)
                    .padding(.horizontal, 6)
                    .frame(minWidth: 18, minHeight: 18)
                    .background(Capsule().fill(theme.accent))
            }
        }
        .foregroundStyle(activeCount > 0 ? theme.accent : theme.ink)
    }
}

/// `PageMenu`'s ☰ button and its small count (paused routines).
struct DesktopPageMenuLabel: View {
    @Environment(\.desktopTheme) private var theme
    var badge = 0

    var body: some View {
        DesktopHeaderButtonLabel {
            DesktopIconView(icon: .menu, size: 16)
        }
        .frame(width: 36, height: 36)
        .overlay(alignment: .topTrailing) {
            if badge > 0 {
                Text(verbatim: "\(badge)")
                    .font(theme.font(11))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 4)
                    .frame(minWidth: 16, minHeight: 14)
                    .background(Capsule().fill(theme.raised))
                    .overlay(Capsule().strokeBorder(theme.app, lineWidth: 1))
                    .offset(x: 4, y: -4)
                    .accessibilityIdentifier("desktop-page-menu-badge")
            }
        }
    }
}

/// The calendar's ‹ Today › and its range (RoutineCalendarPage.tsx).
struct DesktopCalendarNavigation: View {
    @Environment(\.desktopTheme) private var theme
    let range: String
    let previous: () -> Void
    let today: () -> Void
    let next: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: 0) {
                Button(action: previous) {
                    DesktopIconView(icon: .chevronLeft, size: 16)
                        .foregroundStyle(theme.inkSecondary)
                        .padding(6)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Previous dates"))
                .accessibilityIdentifier("automations-previous")
                Button(action: today) {
                    Text("Today")
                        .font(theme.font(12, .medium))
                        .foregroundStyle(theme.ink)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("automations-today")
                Button(action: next) {
                    DesktopIconView(icon: .chevronRight, size: 16)
                        .foregroundStyle(theme.inkSecondary)
                        .padding(6)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Next dates"))
                .accessibilityIdentifier("automations-next")
            }
            Text(verbatim: range)
                .font(theme.font(14, .medium))
                .foregroundStyle(theme.ink)
                .lineLimit(1)
                .accessibilityIdentifier("automations-range")
        }
        .fixedSize()
    }
}
