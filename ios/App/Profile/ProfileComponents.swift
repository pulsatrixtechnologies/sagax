// Shared parts of the bot profile (03 to 10) and the routine screens (05,
// 06): the card, its rows and labels at the measured sizes, the "..." glass
// menu, the share sheet, Quick Look and the schedule wording.
//
// Geometry: docs/superpowers/specs/assets/ios-visual-parity/
// measure-chat-profile.md §3 and §4, in `Theme.Profile`.
import CompanionCore
import QuickLook
import SwiftUI
import UIKit

// MARK: - Card

/// The side margin a profile card takes when its caller names none: the
/// screen's `Theme.Profile.cardMargin`, or 0 inside a column that already
/// sits at that margin (the phone bot panel, #4101). A card padded by its
/// column AND by itself drew twice the margin, narrower than its title.
private struct ProfileCardMarginKey: EnvironmentKey {
    static let defaultValue: CGFloat = Theme.Profile.cardMargin
}

private struct ProfileCardOutlinedKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var profileCardMargin: CGFloat {
        get { self[ProfileCardMarginKey.self] }
        set { self[ProfileCardMarginKey.self] = newValue }
    }

    /// The phone bot panel's cards carry the reference's faint outline (#4101).
    var profileCardOutlined: Bool {
        get { self[ProfileCardOutlinedKey.self] }
        set { self[ProfileCardOutlinedKey.self] = newValue }
    }
}

extension View {
    /// The column's one side margin: every card, footer and control inside
    /// draws flush, so titles, cards and controls share one left and one
    /// right edge (#4101).
    func profileColumn(margin: CGFloat = Theme.Profile.cardMargin) -> some View {
        environment(\.profileCardMargin, 0).padding(.horizontal, margin)
    }
}

/// A #202020 card, radius 16, `margin` from the screen edges.
struct ProfileCard<Content: View>: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.profileCardMargin) private var columnMargin
    @Environment(\.profileCardOutlined) private var outlined
    var margin: CGFloat? = nil
    @ViewBuilder let content: () -> Content

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous)
        VStack(spacing: 0, content: content)
            .frame(maxWidth: .infinity)
            .background(Theme.card, in: shape)
            .clipShape(shape)
            .overlay {
                if outlined { shape.strokeBorder(Theme.hairline, lineWidth: Theme.PhonePanel.cardOutline) }
            }
            .padding(.horizontal, margin ?? columnMargin)
    }
}

/// The 1 pt divider, from `leading` (card-relative) to the trailing edge.
struct ProfileDivider: View {
    @Environment(\.themePalette) var themePalette
    var leading: CGFloat = Theme.Profile.iconColumn - 0.7

    var body: some View {
        Rectangle().fill(Theme.hairline).frame(height: 1).padding(.leading, leading)
    }
}

/// "Character", "Routines", "Schedule": 12 pt grey, 18 pt into the card.
struct ProfileSectionLabel: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.profileCardMargin) private var columnMargin
    let text: LocalizedStringKey
    var margin: CGFloat? = nil

    var body: some View {
        Text(text)
            .font(Theme.Profile.labelFont)
            .foregroundStyle(Theme.textTertiary)
            // the line box of the measured 12 pt, whatever the ink size
            .frame(maxWidth: .infinity, minHeight: 14.3, maxHeight: 14.3, alignment: .topLeading)
            .padding(.leading, (margin ?? columnMargin) + Theme.Profile.textInset)
            .padding(.bottom, Theme.Profile.labelToCard)
    }
}

/// The grey sentence under a card.
struct ProfileFooter: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.profileCardMargin) private var margin
    let text: LocalizedStringKey

    var body: some View {
        Text(text)
            .font(Theme.Profile.labelFont)
            .foregroundStyle(Theme.textTertiary)
            .frame(maxWidth: .infinity, minHeight: 14.3, alignment: .topLeading)
            .padding(.leading, margin + Theme.Profile.textInset)
            .padding(.trailing, margin)
            .padding(.top, Theme.Profile.footerTop)
            .offset(y: 0.63)
    }
}

/// The 7 x 12.3 pt grey chevron.
struct ProfileChevron: View {
    @Environment(\.themePalette) var themePalette
    var body: some View {
        Image(systemName: "chevron.right")
            .font(.system(size: 13.5, weight: .regular))
            .foregroundStyle(Theme.chevron)
            .accessibilityHidden(true)
    }
}

/// A leading icon centred 30 pt into the card.
struct ProfileRowIcon: View {
    @Environment(\.themePalette) var themePalette
    let systemImage: String
    var size: CGFloat = 16
    var color: Color = Theme.iconGrey

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: size, weight: .regular))
            .foregroundStyle(color)
            .frame(width: Theme.Profile.iconCentre * 2, alignment: .center)
            .accessibilityHidden(true)
    }
}

/// One row: an optional icon, a title (and subtitle), and a trailing view.
struct ProfileRow<Trailing: View>: View {
    @Environment(\.themePalette) var themePalette
    var icon: ProfileRowIcon?
    let title: Text
    var subtitle: Text?
    var titleColor: Color = Theme.textPrimary
    var height: CGFloat = Theme.Profile.row
    var textInset: CGFloat = Theme.Profile.textInset
    var subtitleLines = 1
    /// Sub-point optical offset of the text against the measured rows.
    var textOffset: CGFloat?
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 0) {
            if let icon {
                icon.frame(width: Theme.Profile.iconColumn, alignment: .leading)
            } else {
                Color.clear.frame(width: textInset, height: 1)
            }
            VStack(alignment: .leading, spacing: subtitle == nil ? 0 : 3.2) {
                title
                    .font(Theme.Font.body)
                    .foregroundStyle(titleColor)
                    .lineLimit(1)
                if let subtitle {
                    subtitle
                        .font(Theme.Profile.labelFont)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(subtitleLines)
                        .lineSpacing(0.4)
                }
            }
            .offset(y: textOffset ?? (subtitle == nil ? 0.33 : 0.5))
            Spacer(minLength: 12)
            trailing()
        }
        .frame(height: height)
        .contentShape(Rectangle())
    }
}

extension ProfileRow where Trailing == EmptyView {
    init(icon: ProfileRowIcon? = nil, title: Text, subtitle: Text? = nil, titleColor: Color = Theme.textPrimary, height: CGFloat = Theme.Profile.row) {
        self.init(icon: icon, title: title, subtitle: subtitle, titleColor: titleColor, height: height) { EmptyView() }
    }
}

/// A trailing chevron with the measured right inset.
struct ProfileChevronTrailing: View {
    @Environment(\.themePalette) var themePalette
    var body: some View {
        ProfileChevron().padding(.trailing, Theme.Profile.chevronTrailing)
    }
}

/// "Show more" under a list: 14 medium grey, centred.
struct ShowMoreButton: View {
    @Environment(\.themePalette) var themePalette
    let loading: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Text("Show more")
                    .font(Theme.Font.bodyMedium)
                    .foregroundStyle(Theme.showMore)
                    .opacity(loading ? 0 : 1)
                if loading { ProgressView().controlSize(.small) }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 22)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(loading)
        .padding(.top, Theme.Profile.showMoreTop - 3)
        .accessibilityIdentifier("profile-show-more")
    }
}

// MARK: - Screen chrome

/// The content scrolled under the top buttons fades into the background
/// (04: the card reads #1C1C1C at y 112, #181818 at y 64, gone by y 40).
struct ProfileTopFade: View {
    @Environment(\.themePalette) var themePalette
    var body: some View {
        LinearGradient(
            stops: [
                .init(color: Theme.bg, location: 0),
                .init(color: Theme.bg, location: 40 / 150),
                .init(color: Theme.bg.opacity(0.67), location: 64 / 150),
                .init(color: Theme.bg.opacity(0.33), location: 112 / 150),
                .init(color: Theme.bg.opacity(0), location: 1),
            ],
            startPoint: .top, endPoint: .bottom
        )
        .frame(height: 150)
        .frame(maxWidth: .infinity)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// A pushed screen's back circle (chevron ink 8.7 x 15.3 pt).
struct ProfileBackButton: View {
    @Environment(\.themePalette) var themePalette
    /// The settings sheet's pages keep their own id ("settings-back").
    var identifier = "profile-back"
    let action: () -> Void

    var body: some View {
        GlassCircleButton(
            systemImage: "chevron.left", accessibilityLabel: "Back",
            glyphSize: 18, glyphOffset: CGSize(width: 0.85, height: -0.25), action: action
        )
        .chatGlassRim(Circle())
        .accessibilityIdentifier(identifier)
    }
}

// MARK: - Glass menu (07)

/// One item of the "..." menu.
struct GlassMenuItem: Identifiable {
    let id: String
    let title: Text
    let systemImage: String
    var destructive = false
    var disabled = false
    /// A hairline above the item, and an optional small heading under it
    /// (the desktop's divider and its "Export conversation" heading).
    var dividerBefore = false
    var heading: Text? = nil
    let action: () -> Void
}

/// The "..." menu as reference 07 draws it: a 250 pt glass panel that grows
/// from the button, 6 pt above its top and 8.3 pt from the screen edge, with
/// a 36 pt row pitch and no separators.
struct GlassMenuPanel: View {
    @Environment(\.themePalette) var themePalette
    let items: [GlassMenuItem]
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(items) { item in
                if item.dividerBefore {
                    Rectangle().fill(Theme.hairline.opacity(0.6)).frame(height: 0.5)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 4)
                }
                if let heading = item.heading {
                    heading
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.leading, Theme.Profile.menuIconColumn - 3)
                        .frame(height: 24)
                }
                Button {
                    Haptics.selection()
                    close()
                    item.action()
                } label: {
                    HStack(spacing: 0) {
                        Image(systemName: item.systemImage)
                            .font(.system(size: 16, weight: .regular))
                            .foregroundStyle(item.destructive ? Theme.destructiveMenu : Theme.parity(Color(hex: 0xFAF9FC), Theme.textPrimary))
                            .frame(width: 20)
                            .padding(.leading, Theme.Profile.menuIconColumn - 3)
                        item.title
                            .font(Theme.Font.body)
                            .foregroundStyle(item.destructive ? Theme.destructiveMenu : Theme.parity(Color(hex: 0xFAF9FC), Theme.textPrimary))
                            .padding(.leading, Theme.Profile.menuTextColumn - Theme.Profile.menuIconColumn - 17)
                        Spacer(minLength: 8)
                    }
                    .frame(height: Theme.Profile.menuRowPitch)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(item.disabled)
                .opacity(item.disabled ? 0.4 : 1)
                .accessibilityIdentifier("profile-menu.\(item.id)")
            }
        }
        .padding(.vertical, 9.4)
        .frame(width: Theme.Profile.menuWidth, alignment: .leading)
        .background {
            let shape = RoundedRectangle(cornerRadius: Theme.Profile.menuRadius, style: .continuous)
            ZStack {
                shape.fill(.ultraThinMaterial)
                shape.fill(Theme.menuGlass.opacity(0.82))
                shape.strokeBorder(
                    LinearGradient(colors: [Theme.parity(Color(hex: 0x767676), Theme.hairline), Theme.parity(Color(hex: 0x3A3A3A).opacity(0.4), Theme.hairline.opacity(0.4))], startPoint: .top, endPoint: .bottom),
                    lineWidth: 0.8
                )
            }
        }
        .shadow(color: .black.opacity(Theme.palette.isDark ? 0.25 : 0.12), radius: 18, y: 6)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("profile-menu")
    }
}

// MARK: - Share sheet and Quick Look

/// The system share sheet for one or more items.
struct ProfileShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
        controller.view.accessibilityIdentifier = "profile-share-sheet"
        return controller
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// Quick Look on a downloaded file.
struct ProfileQuickLook: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator(url: url) }

    func makeUIViewController(context: Context) -> UINavigationController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return UINavigationController(rootViewController: controller)
    }

    func updateUIViewController(_ controller: UINavigationController, context: Context) {
        context.coordinator.url = url
        (controller.viewControllers.first as? QLPreviewController)?.reloadData()
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
    }
}

/// A sheet item wrapping a URL.
struct IdentifiedURL: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

// MARK: - Schedule wording

enum RoutineWording {
    /// The profile row's subtitle: a sentence ("Every Monday at 7:00 AM",
    /// "Weekdays at 8:11 AM", "Every 2 hours, from 7:13 AM to 9:13 PM"; a
    /// cron a sentence cannot say reads "Custom schedule"), then
    /// " · Paused" when it is off.
    static func subtitle(_ routine: Routine) -> String {
        let base = schedule(routine.schedule)
        if RoutineAutoPause.isAutoPaused(routine), let failures = routine.autoPaused?.failures {
            return "\(base) · \(autoPaused(failures))"
        }
        return routine.enabled ? base : String(localized: "\(base) · Paused")
    }

    /// The list row's short line (the full wording with the zone stays in
    /// the editor): "Weekdays around 8:30 AM", "Every Monday around 8:06 AM",
    /// "Once October 29 at 5:57 PM". The zone shows only when it is not the
    /// phone's own. A schedule that does not reduce keeps its full wording.
    /// The desktop's `scheduleLabel` (src/lib/schedule-label.ts), word for
    /// word: "Weekly on Mon at 7:00 AM", "Every weekday at 9:00 AM", "Every
    /// day at 8:00 AM", "Incoming webhook"; a cron schedule as `compact`.
    static func desktop(_ schedule: RoutineSchedule) -> String {
        switch schedule.type {
        case .daily:
            let days = (schedule.weekdays ?? []).sorted()
            let label: String
            if days.count == 7 || days.isEmpty { label = String(localized: "Every day") }
            else if days == [1, 2, 3, 4, 5] { label = String(localized: "Every weekday") }
            else if days.count == 1 { label = String(localized: "Weekly on \(Self.shortDay(days[0]))") }
            else { label = days.map(Self.shortDay).joined(separator: ", ") }
            let time = timeText(schedule)
            if schedule.timing == "flexible" {
                let note = "(-\(schedule.windowEarlyMinutes ?? 0)/+\(schedule.windowLateMinutes ?? 0) min)"
                return String(localized: "\(label) around \(time) \(note)")
            }
            return String(localized: "\(label) at \(time)")
        case .once:
            guard let at = schedule.at else { return Self.schedule(schedule) }
            let date = Date(timeIntervalSince1970: at / 1_000)
            return "\(date.formatted(.dateTime.weekday(.wide).month(.wide).day())), \(date.formatted(date: .omitted, time: .shortened))"
        case .webhook: return String(localized: "Incoming webhook")
        case .event:
            if schedule.isProductEvent { return String(localized: "Product change: \(Self.productResources(schedule))") }
            return String(localized: "Incoming email")
        default: return compact(schedule)
        }
    }

    /// The watched resources of a product change trigger, as the desktop
    /// lists them (#4250).
    static func productResources(_ schedule: RoutineSchedule) -> String {
        (schedule.resources ?? []).joined(separator: ", ")
    }

    /// Short weekday names, index 0 = Sunday (the desktop's `dayNames`).
    static func shortDay(_ index: Int) -> String {
        let names = Calendar.current.shortWeekdaySymbols
        return names[((index % 7) + 7) % 7]
    }

    static func compact(_ schedule: RoutineSchedule) -> String {
        switch schedule.type {
        case .cron:
            if let wording = schedule.cronWording, wording.minutesOfDay.count == 1, let minutes = wording.minutesOfDay.first {
                return sentence(wording.days, time: clockText(hour: minutes / 60, minute: minutes % 60), around: true) + zoneSuffix(wording.timeZone)
            }
            return Self.schedule(schedule)
        case .once:
            guard let at = schedule.at else { return Self.schedule(schedule) }
            let date = Date(timeIntervalSince1970: at / 1_000)
            let day = date.formatted(.dateTime.month(.wide).day())
            let time = date.formatted(date: .omitted, time: .shortened).replacingOccurrences(of: "\u{202F}", with: " ")
            return String(localized: "Once \(day) at \(time)")
        case .daily:
            return sentence(schedule.dayPattern, time: timeText(schedule), around: true)
        default:
            return Self.schedule(schedule)
        }
    }

    static func schedule(_ schedule: RoutineSchedule) -> String {
        switch schedule.type {
        case .cron:
            return words(schedule) + zoneSuffix(schedule.timeZone)
        case .once:
            guard let at = schedule.at else { return String(localized: "One time") }
            return Date(timeIntervalSince1970: at / 1_000).formatted(date: .abbreviated, time: .shortened)
        case .interval:
            let every: String
            if let hours = schedule.intervalHours {
                every = hours == 1 ? String(localized: "Every hour") : String(localized: "Every \(hours) hours")
            } else {
                every = String(localized: "Every \(schedule.everyMinutes ?? 0) min")
            }
            // "Every 2 hours, from 7:13 AM to 9:13 PM"
            if let window = schedule.window,
               let start = clockText(window.start), let end = clockText(window.end) {
                return String(localized: "\(every), from \(start) to \(end)")
            }
            return every
        case .webhook:
            return String(localized: "When a webhook fires")
        case .event:
            if schedule.isProductEvent { return String(localized: "When \(Self.productResources(schedule)) changes") }
            return String(localized: "When email arrives")
        case .unknown:
            return String(localized: "Newer schedule")
        case .daily:
            break
        }
        return sentence(schedule.dayPattern, time: timeText(schedule))
    }

    /// A cron schedule in words, without its zone: a simple one says itself
    /// ("Weekdays at 8:11 AM"), lists, ranges and steps are described
    /// ("Weekdays, 8 AM to 6 PM, at :00, :17"), and what no sentence can say
    /// reads "Custom schedule" (2026-10-29: never the raw expression).
    static func words(_ schedule: RoutineSchedule) -> String {
        if let wording = schedule.cronWording {
            return sentence(wording.days, time: times(wording.minutesOfDay))
        }
        guard let expression = schedule.expression else { return String(localized: "Custom schedule") }
        // Several expressions (one per minute of a day) say their times together.
        if expression.contains(";") {
            return CronDescribe.describeList(expression, language: CronDescribe.currentLanguage) ?? String(localized: "Custom schedule")
        }
        if let minutes = lastDayOfMonth(expression) {
            return String(localized: "On the last day of the month at \(times(minutes))")
        }
        return CronDescribe.describe(expression, language: CronDescribe.currentLanguage) ?? String(localized: "Custom schedule")
    }

    /// The editor's summary: the words, then the zone as a city ("Weekdays
    /// at 8:30 AM (Toronto time)").
    static func summary(_ schedule: RoutineSchedule) -> String {
        let words = schedule.type == .cron ? words(schedule) : Self.schedule(schedule)
        guard let zone = schedule.type == .cron ? schedule.timeZone : TimeZone.current.identifier, !zone.isEmpty else { return words }
        return String(localized: "\(words) (\(RoutineScheduleModel.timeZoneCity(zone)) time)")
    }

    private static func times(_ minutesOfDay: [Int]) -> String {
        ListFormatter.localizedString(byJoining: minutesOfDay.map { clockText(hour: $0 / 60, minute: $0 % 60) })
    }

    /// "M H1,H2 L * *": the minutes of day of a last-day-of-month schedule.
    private static func lastDayOfMonth(_ expression: String) -> [Int]? {
        let fields = expression.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
        guard fields.count == 5, fields[2] == "L", fields[3] == "*", fields[4] == "*",
              let minute = Int(fields[0]), (0..<60).contains(minute) else { return nil }
        var hours: [Int] = []
        for part in fields[1].split(separator: ",", omittingEmptySubsequences: false) {
            guard let hour = Int(part), (0..<24).contains(hour) else { return nil }
            hours.append(hour)
        }
        return Array(Set(hours)).sorted().map { $0 * 60 + minute }
    }

    /// Which days, then when: "Weekdays at 8:11 AM".
    private static func sentence(_ days: RoutineSchedule.DayPattern, time: String, around: Bool = false) -> String {
        if around {
            switch days {
            case .everyDay: return String(localized: "Every day around \(time)")
            case .weekdays: return String(localized: "Weekdays around \(time)")
            case let .days(days) where days.count == 1: return String(localized: "Every \(weekdayName(days[0])) around \(time)")
            default: break
            }
        }
        switch days {
        case .everyDay: return String(localized: "Every day at \(time)")
        case .weekdays: return String(localized: "Weekdays at \(time)")
        case .weekends: return String(localized: "Weekends at \(time)")
        case let .days(days) where days.count == 1:
            return String(localized: "Every \(weekdayName(days[0])) at \(time)")
        case let .days(days):
            let names = days.map(shortWeekdayName).joined(separator: ", ")
            return String(localized: "\(names) at \(time)")
        case .none:
            return String(localized: "No days chosen")
        }
    }

    /// 2026-10-26 (RoutineAutoPause): "Paused after 5 failures in a row".
    static func autoPaused(_ failures: Int) -> String {
        failures == 1 ? String(localized: "Paused after a failure") : String(localized: "Paused after \(failures) failures in a row")
    }

    /// The editor's words for a choice of RoutineAutoPause.choices.
    static func autoPauseOption(_ count: Int) -> String {
        if count == 0 { return String(localized: "Never") }
        return count == 1 ? String(localized: "After 1 failed run") : String(localized: "After \(count) failed runs in a row")
    }

    static func nextRun(_ routine: Routine, now: Date = Date()) -> String {
        guard routine.enabled else { return String(localized: "Paused") }
        switch routine.nextRun(now: now) {
        case .none: return String(localized: "Not scheduled")
        case .dueNow: return String(localized: "due now")
        case let .at(date):
            let formatter = RelativeDateTimeFormatter()
            formatter.unitsStyle = .full
            return formatter.localizedString(for: date, relativeTo: now)
        }
    }

    private static func timeText(_ schedule: RoutineSchedule) -> String {
        guard let time = schedule.timeOfDay else { return schedule.time ?? "" }
        return clockText(hour: time.hour, minute: time.minute)
    }

    /// "07:13" as the phone writes a time of day; nil when unreadable.
    private static func clockText(_ text: String) -> String? {
        let parts = text.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2, (0..<24).contains(parts[0]), (0..<60).contains(parts[1]) else { return nil }
        return clockText(hour: parts[0], minute: parts[1])
    }

    private static func clockText(hour: Int, minute: Int) -> String {
        guard let date = Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: Date()) else {
            return String(format: "%02d:%02d", hour, minute)
        }
        // the reference spaces "7:00 AM" with an ordinary space
        return date.formatted(date: .omitted, time: .shortened).replacingOccurrences(of: "\u{202F}", with: " ")
    }

    /// A cron's times are in its own zone: named when it is not the phone's.
    private static func zoneSuffix(_ zone: String?) -> String {
        guard let zone, zone != TimeZone.current.identifier,
              TimeZone(identifier: zone)?.secondsFromGMT() != TimeZone.current.secondsFromGMT()
        else { return "" }
        let city = zone.split(separator: "/").last.map { $0.replacingOccurrences(of: "_", with: " ") } ?? zone
        return " (\(city))"
    }

    private static func weekdayName(_ day: Int) -> String {
        let symbols = Calendar.current.standaloneWeekdaySymbols
        return symbols.indices.contains(day) ? symbols[day] : ""
    }

    private static func shortWeekdayName(_ day: Int) -> String {
        let symbols = Calendar.current.shortStandaloneWeekdaySymbols
        return symbols.indices.contains(day) ? symbols[day] : ""
    }
}

// MARK: - Share glyph

/// The reference's share mark (ink 17.7 x 17.7 pt at 44 pt): an open tray
/// with rounded bottom corners and an arrow up out of it. Today's SF symbol
/// closes the tray into a box, so it is drawn.
struct ShareGlyph: Shape {
    var lineWidth: CGFloat = 1.9

    func path(in rect: CGRect) -> Path {
        let w = rect.width, h = rect.height
        let s = min(w, h) / 18
        let inset = lineWidth / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * s, y: rect.minY + y * s) }
        var path = Path()
        // tray
        let r: CGFloat = 2.6
        path.move(to: p(inset / s, 9.6))
        path.addLine(to: p(inset / s, 18 - inset / s - r))
        path.addQuadCurve(to: p(inset / s + r, 18 - inset / s), control: p(inset / s, 18 - inset / s))
        path.addLine(to: p(18 - inset / s - r, 18 - inset / s))
        path.addQuadCurve(to: p(18 - inset / s, 18 - inset / s - r), control: p(18 - inset / s, 18 - inset / s))
        path.addLine(to: p(18 - inset / s, 9.6))
        // arrow
        path.move(to: p(9, 12.4))
        path.addLine(to: p(9, inset / s + 0.4))
        path.move(to: p(4.6, 4.9))
        path.addLine(to: p(9, inset / s + 0.3))
        path.addLine(to: p(13.4, 4.9))
        return path.strokedPath(StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
    }
}

/// A 44 pt glass circle holding the share glyph.
struct ShareGlassButton: View {
    @Environment(\.themePalette) var themePalette
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            ShareGlyph()
                .fill(Theme.textPrimary)
                .frame(width: 18, height: 18)
                .frame(width: Theme.Metric.glassLarge, height: Theme.Metric.glassLarge)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .themeGlass(Circle())
        .chatGlassRim(Circle())
    }
}
