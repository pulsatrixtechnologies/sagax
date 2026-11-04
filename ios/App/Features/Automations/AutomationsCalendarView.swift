// The Automations page's calendar on the phone (matrix AU2-AU4): one day as
// an agenda of 24 hour rows, the desktop's day view
// (src/components/RoutineCalendarPage.tsx CalendarGrid with `days` 1), with
// Previous, Today and Next, the range label, and the mini month
// (routines/MiniMonth.tsx) as a graphical date picker.
//
// Phone gestures stand in for the desktop's pointer ones: a tap on an empty
// hour is the click on a slot (create there), a long press on an event offers
// Reschedule in place of the drag. The rules (what a day shows, columns,
// the moved schedule) are RoutineCalendar in CompanionCore.
//
// Layout-agnostic: it takes its data and reports intents, so the iPhone page
// and a future iPad shell host the same view.
import CompanionCore
import SwiftUI
import UIKit

/// The iPad desktop shell's Automations page draws the desktop's week
/// (`days` 7, RoutineCalendarPage.tsx CalendarGrid); the phone keeps its day.
private struct AutomationsGridDaysKey: EnvironmentKey { static let defaultValue = 1 }
extension EnvironmentValues {
    var automationsGridDays: Int {
        get { self[AutomationsGridDaysKey.self] }
        set { self[AutomationsGridDaysKey.self] = newValue }
    }
}

/// The iPad desktop shell (lot 4): the page draws the desktop's own header
/// (RoutineCalendarPage.tsx `PageHeader`) and right column instead of the
/// phone's pickers and its navigation bar.
private struct AutomationsDesktopKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    var automationsDesktop: Bool {
        get { self[AutomationsDesktopKey.self] }
        set { self[AutomationsDesktopKey.self] = newValue }
    }
}

/// What an event's long-press menu asks the page to do.
enum AutomationsEventAction {
    case open, reschedule, edit, runNow, toggle, logs
}

struct AutomationsCalendarView<Header: View>: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.automationsGridDays) private var gridDays
    @Binding var day: Date
    let routines: [Routine]
    let runs: [RoutineRun]
    let bots: [Bot]
    var botId: String?
    var loading = false
    /// The page's pickers above the day.
    @ViewBuilder var header: () -> Header
    /// The desktop header's right end (Filters, the menu, New).
    var trailing: () -> AnyView = { AnyView(EmptyView()) }
    /// A tap on an empty slot: create a routine there.
    let onCreate: (Date) -> Void
    let onAction: (AutomationsEventAction, RoutineCalendarItem) -> Void

    @State private var choosingDate = false

    /// `HOUR_HEIGHT`.
    static var hourHeight: CGFloat { 64 }
    private static var gutter: CGFloat { 52 }

    private var items: [RoutineCalendarItem] {
        RoutineCalendar.day(day, routines: routines, runs: runs, botId: botId)
    }

    var body: some View {
        if gridDays > 1 {
            AnyView(AutomationsWeekView(
                day: $day, routines: routines, runs: runs, bots: bots, botId: botId, loading: loading,
                header: { AnyView(header()) }, trailing: trailing, onCreate: onCreate, onAction: onAction
            ))
        } else {
            AnyView(dayBody)
        }
    }

    private var dayBody: some View {
        VStack(spacing: 0) {
            VStack(spacing: 10) {
                header()
                navigation
            }
            .padding(.horizontal, Theme.Metric.screenEdge)
            .padding(.bottom, 10)
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
            agenda
        }
        .background(Theme.bg.ignoresSafeArea())
        .sheet(isPresented: $choosingDate) { miniMonth }
    }

    // MARK: Navigation

    private var navigation: some View {
        HStack(spacing: 8) {
            HStack(spacing: 0) {
                Button { day = RoutineCalendar.addDays(day, -1) } label: {
                    Image(systemName: "chevron.left").frame(width: 36, height: 32)
                }
                .accessibilityLabel(Text("Previous dates"))
                .accessibilityIdentifier("automations-previous")
                Button(String(localized: "Today")) { day = RoutineCalendar.startOfDay(Date()) }
                    .font(Theme.Font.labelMedium)
                    .padding(.horizontal, 8)
                    .accessibilityIdentifier("automations-today")
                Button { day = RoutineCalendar.addDays(day, 1) } label: {
                    Image(systemName: "chevron.right").frame(width: 36, height: 32)
                }
                .accessibilityLabel(Text("Next dates"))
                .accessibilityIdentifier("automations-next")
            }
            .foregroundStyle(Theme.textPrimary)
            .background(RoundedRectangle(cornerRadius: 9).fill(Theme.card))
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(Theme.hairline, lineWidth: 0.5))
            Button { choosingDate = true } label: {
                HStack(spacing: 4) {
                    Text(verbatim: RoutineCalendar.dayLabel(day))
                        .font(Theme.Font.bodyMedium)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Image(systemName: "chevron.down").font(.caption2.weight(.semibold))
                }
                .foregroundStyle(Theme.textPrimary)
            }
            .accessibilityHint(Text("Choose a date"))
            .accessibilityIdentifier("automations-range")
            Spacer(minLength: 0)
            if loading { ProgressView().controlSize(.small) }
        }
    }

    private var miniMonth: some View {
        NavigationStack {
            DatePicker(
                String(localized: "Date"),
                selection: Binding(get: { day }, set: { day = RoutineCalendar.startOfDay($0); choosingDate = false }),
                displayedComponents: .date
            )
            .datePickerStyle(.graphical)
            .tint(Theme.accent)
            .padding(.horizontal)
            .accessibilityIdentifier("automations-mini-month")
            .navigationTitle(Text("Choose a date"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "Today")) { day = RoutineCalendar.startOfDay(Date()); choosingDate = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Done")) { choosingDate = false }
                }
            }
            .frame(maxHeight: .infinity, alignment: .top)
            .background(Theme.bg.ignoresSafeArea())
        }
        .presentationDetents([.medium, .large])
    }

    // MARK: Agenda

    private var agenda: some View {
        ScrollViewReader { reader in
            ScrollView {
                HStack(alignment: .top, spacing: 0) {
                    hourLabels
                    GeometryReader { proxy in
                        ZStack(alignment: .topLeading) {
                            slots
                            if Calendar.current.isDateInToday(day) { nowLine }
                            events(width: proxy.size.width)
                        }
                    }
                    .frame(height: Self.hourHeight * 24)
                }
                .padding(.trailing, 8)
                .padding(.vertical, 10)
                if !loading && items.isEmpty {
                    Text("Nothing scheduled this day. Tap an hour to schedule a routine.")
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.bottom, 24)
                        .accessibilityIdentifier("automations-day-empty")
                }
            }
            .accessibilityIdentifier("automations-agenda")
            .onAppear { scrollToStart(reader) }
            .onValueChange(of: day) { _ in scrollToStart(reader) }
        }
    }

    /// As the desktop opens a grid: two hours before now on today, else 7 AM.
    private func scrollToStart(_ reader: ScrollViewProxy) {
        let hour = Calendar.current.isDateInToday(day) ? max(0, Calendar.current.component(.hour, from: Date()) - 2) : 7
        reader.scrollTo("hour-\(hour)", anchor: .top)
    }

    private var hourLabels: some View {
        VStack(spacing: 0) {
            ForEach(0..<24, id: \.self) { hour in
                Text(verbatim: hour == 0 ? "" : Self.hourText(hour))
                    .font(Theme.Font.label)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textTertiary)
                    .frame(width: Self.gutter - 8, height: Self.hourHeight, alignment: .topTrailing)
                    .offset(y: -6)
                    .padding(.trailing, 8)
                    .id("hour-\(hour)")
            }
        }
        .accessibilityHidden(true)
    }

    static func hourText(_ hour: Int) -> String {
        let date = Calendar.current.date(bySettingHour: hour, minute: 0, second: 0, of: Date()) ?? Date()
        return date.formatted(.dateTime.hour())
    }

    /// The hour rows: half-hour lines, and a tap creates at the 5-minute
    /// slot under the finger (`slotAt`), as a click on the desktop grid.
    private var slots: some View {
        VStack(spacing: 0) {
            ForEach(0..<24, id: \.self) { hour in
                ZStack(alignment: .top) {
                    Rectangle().fill(Theme.hairline).frame(height: 0.5)
                    Rectangle().fill(Theme.hairline.opacity(0.4)).frame(height: 0.5).offset(y: Self.hourHeight / 2)
                }
                .frame(maxWidth: .infinity, minHeight: Self.hourHeight, maxHeight: Self.hourHeight, alignment: .top)
                .contentShape(Rectangle())
                .gesture(SpatialTapGesture().onEnded { value in
                    let minutes = Double(hour) * 60 + Double(value.location.y / Self.hourHeight) * 60
                    onCreate(RoutineCalendar.slot(day: day, minutes: minutes))
                })
                .accessibilityElement()
                .accessibilityLabel(Text(verbatim: Self.hourText(hour)))
                .accessibilityHint(Text("Schedule a routine at this time"))
                .accessibilityAddTraits(.isButton)
                .accessibilityAction {
                    onCreate(RoutineCalendar.slot(day: day, minutes: Double(hour) * 60))
                }
                .accessibilityIdentifier("automations-hour.\(hour)")
            }
        }
    }

    private var nowLine: some View {
        let now = Date()
        let minutes = Calendar.current.component(.hour, from: now) * 60 + Calendar.current.component(.minute, from: now)
        return HStack(spacing: 0) {
            Circle().fill(Theme.danger).frame(width: 8, height: 8).offset(x: -4)
            Rectangle().fill(Theme.danger.opacity(0.8)).frame(height: 1)
        }
        .offset(y: CGFloat(minutes) / 60 * Self.hourHeight - 4)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func events(width: CGFloat) -> some View {
        let shown = items
        let layouts = RoutineCalendar.pack(shown)
        return ForEach(shown) { item in
            let layout = layouts[item.id] ?? RoutineCalendarLayout(column: 0, columns: 1)
            let columnWidth = width / CGFloat(layout.columns)
            let parts = Calendar.current.dateComponents([.hour, .minute], from: item.date)
            let top = CGFloat((parts.hour ?? 0) * 60 + (parts.minute ?? 0)) / 60 * Self.hourHeight
            AutomationsEventCard(item: item, bot: item.botId.flatMap { id in bots.first { $0.id == id } }, rooms: [])
                .frame(width: max(0, columnWidth - 4), height: max(16, CGFloat(item.durationMinutes) / 60 * Self.hourHeight))
                .offset(x: CGFloat(layout.column) * columnWidth + 2, y: top)
                .onTapGesture { onAction(.open, item) }
                .contextMenu { menu(item) }
        }
    }

    @ViewBuilder
    private func menu(_ item: RoutineCalendarItem) -> some View {
        if item.run != nil {
            Button(String(localized: "Open run"), systemImage: "doc.text") { onAction(.open, item) }
        }
        if item.canMove {
            Button(String(localized: "Reschedule"), systemImage: "calendar.badge.clock") { onAction(.reschedule, item) }
                .accessibilityIdentifier("automations-reschedule")
        }
        if let routine = item.routine {
            // AU20: someone else's routine is read-only (canEdit, canRun)
            if routine.mayEdit {
                Button(String(localized: "Edit"), systemImage: "pencil") { onAction(.edit, item) }
            }
            if routine.mayRun {
                Button(String(localized: "Run now"), systemImage: "play.fill") { onAction(.runNow, item) }
            }
            if routine.mayEdit && routine.canToggle() {
                Button(routine.enabled ? String(localized: "Pause") : String(localized: "Resume"),
                       systemImage: routine.enabled ? "pause" : "play") { onAction(.toggle, item) }
            }
            Button(String(localized: "Run logs"), systemImage: "list.bullet.rectangle") { onAction(.logs, item) }
        }
    }
}

/// One event on the day (`CalendarEventCard`): the bot's colour, its mascot
/// when there is room, the name, then the time and the cadence, team goal,
/// run status or bot.
struct AutomationsEventCard: View {
    @Environment(\.themePalette) var themePalette
    let item: RoutineCalendarItem
    let bot: Bot?
    var rooms: [Room] = []
    /// The desktop's week (`compact`, days 7): the name only, on one line,
    /// a 16 pt mascot from 30 minutes, the bot's colour as a gradient.
    var compact = false

    var body: some View {
        if compact { compactBody } else { fullBody }
    }

    private var compactBody: some View {
        let color = bot.map { MausPalette.ink($0.color) } ?? Theme.textSecondary
        let status = item.run?.status
        return HStack(alignment: .top, spacing: 6) {
            if let bot, item.durationMinutes >= 30 {
                BotMascotView(bot: bot, size: 16, state: Self.state(status), animated: false)
                    .frame(width: 16, height: 16)
            }
            Text(verbatim: item.name)
                .font(Theme.font(11, .semibold))
                .foregroundStyle(Color.white)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, item.durationMinutes < 30 ? 6 : 8)
        .padding(.vertical, item.durationMinutes < 30 ? 0 : 6)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(
            // linear-gradient(110deg, color 58 % into #242424, color 28 % into #181818)
            LinearGradient(colors: [Self.mix(color, 0.58, 0x24), Self.mix(color, 0.28, 0x18)],
                           startPoint: UnitPoint(x: 0.16, y: 0.0), endPoint: UnitPoint(x: 0.84, y: 1.0)),
            in: RoundedRectangle(cornerRadius: 6)
        )
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(status == "failed" || status == "missed" ? Theme.danger.opacity(0.6) : color.opacity(0.7), lineWidth: 1))
        .opacity(status == "cancelled" ? 0.55 : 1)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("automations-event.\(item.name)")
    }

    /// `color-mix(in srgb, color p, #gggggg)`.
    static func mix(_ color: Color, _ p: CGFloat, _ grey: Int) -> Color {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a)
        let q = CGFloat(grey) / 255
        return Color(red: r * p + q * (1 - p), green: g * p + q * (1 - p), blue: b * p + q * (1 - p))
    }

    @ViewBuilder
    private var fullBody: some View {
        let color = bot.map { MausPalette.ink($0.color) } ?? Theme.textSecondary
        let status = item.run?.status
        HStack(alignment: .top, spacing: 6) {
            if let bot, item.durationMinutes >= 30 {
                BotMascotView(bot: bot, size: 22, state: Self.state(status), animated: false)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: item.name)
                    .font(Theme.font(11, .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                Text(verbatim: detail)
                    .font(Theme.font(9.5))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(
            ZStack {
                RoundedRectangle(cornerRadius: 6).fill(Theme.card)
                RoundedRectangle(cornerRadius: 6).fill(color.opacity(0.28))
            }
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(status == "failed" || status == "missed" ? Theme.danger.opacity(0.6) : color.opacity(0.7), lineWidth: 1)
        )
        .opacity(status == "cancelled" ? 0.55 : 1)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("automations-event.\(item.name)")
    }

    private var detail: String {
        let time = item.date.formatted(date: .omitted, time: .shortened)
        let schedule = item.routine?.schedule
        let rest: String
        if let schedule, schedule.type == .interval {
            rest = RoutineWording.schedule(schedule)
        } else if (item.run?.target ?? item.routine?.target) == "room-goal" {
            let status = item.run.map(RoutineRunWording.label)
            rest = [String(localized: "Team goal"), status].compactMap { $0 }.joined(separator: " · ")
        } else if let run = item.run {
            rest = RoutineRunWording.label(run)
        } else {
            rest = bot?.name ?? ""
        }
        return rest.isEmpty ? time : "\(time) · \(rest)"
    }

    /// `statusState`.
    static func state(_ status: String?) -> MausState {
        switch status {
        case nil: .idle
        case "running": .working
        case "waiting": .curious
        case "completed": .proud
        case "failed", "missed": .sad
        case "cancelled": .sleeping
        default: .drowsy
        }
    }
}
