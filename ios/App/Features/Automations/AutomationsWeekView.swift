// The iPad desktop shell's Automations calendar: the desktop's week
// (src/components/RoutineCalendarPage.tsx CalendarGrid, `days` 7, weeks
// from Monday as `startOfWeek`), the hour gutter and seven columns of 64 pt
// hours with half-hour lines, each day's header (weekday 10 pt uppercase,
// the date 15 pt in a 32 pt circle, the accent on today), the events packed
// side by side per day (RoutineCalendar.day / pack), the now line; and the
// right column: the month (a graphical date picker) and My bots.
//
// The phone keeps its day agenda (AutomationsCalendarView); the rules are
// RoutineCalendar's, shared with it.
import CompanionCore
import SwiftUI

struct AutomationsWeekView: View {
    @Environment(\.themePalette) var themePalette
    @Binding var day: Date
    let routines: [Routine]
    let runs: [RoutineRun]
    let bots: [Bot]
    var botId: String?
    var loading = false
    let header: () -> AnyView
    var trailing: () -> AnyView = { AnyView(EmptyView()) }
    let onCreate: (Date) -> Void
    let onAction: (AutomationsEventAction, RoutineCalendarItem) -> Void

    @State private var botQuery = ""
    /// The right rail open (`botsOpen`); its › folds it to the strip.
    @State private var railOpen = true
    @Environment(\.automationsDesktop) private var desktop
    @Environment(\.desktopTheme) private var theme

    private static var hourHeight: CGFloat { 64 }
    /// `64px` on the desktop's grid; the phone's narrower week keeps 48.
    private var gutter: CGFloat { desktop ? 64 : 48 }

    /// `startOfWeek`: the Monday of the week holding `date`.
    static func weekStart(_ date: Date, calendar: Calendar = .current) -> Date {
        let start = RoutineCalendar.startOfDay(date, calendar: calendar)
        let weekday = calendar.component(.weekday, from: start) // 1 = Sunday
        return RoutineCalendar.addDays(start, -((weekday + 5) % 7), calendar: calendar)
    }

    private var weekStart: Date { Self.weekStart(day) }
    private var days: [Date] { (0..<7).map { RoutineCalendar.addDays(weekStart, $0) } }

    private var rangeLabel: String { Self.rangeLabel(weekStart, desktop: desktop) }

    static func rangeLabel(_ weekStart: Date, desktop: Bool) -> String {
        let end = RoutineCalendar.addDays(weekStart, 6)
        if desktop {
            // the desktop's `rangeLabel`: "November 2 - 8, 2026"
            let sameMonth = Calendar.current.isDate(weekStart, equalTo: end, toGranularity: .month)
            let start = weekStart.formatted(.dateTime.month(.wide).day())
            let tail = sameMonth ? end.formatted(.dateTime.day()) : end.formatted(.dateTime.month(.wide).day())
            return "\(start) - \(tail), \(end.formatted(.dateTime.year()))"
        }
        let start = weekStart.formatted(.dateTime.month(.abbreviated).day())
        let sameMonth = Calendar.current.isDate(weekStart, equalTo: end, toGranularity: .month)
        let tail = sameMonth ? end.formatted(.dateTime.day().year()) : end.formatted(.dateTime.month(.abbreviated).day().year())
        return "\(start) – \(tail)"
    }

    var body: some View {
        if desktop {
            // the page's header holds the view switch and the dates
            HStack(spacing: 0) {
                AnyView(grid)
                    .overlay(alignment: .top) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 0.5) }
                    .overlay(alignment: .leading) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(width: 0.5) }
                if railOpen {
                    AnyView(desktopSide)
                        .frame(width: 280)
                        .background(theme.panel)
                        .overlay(alignment: .leading) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(width: 0.5) }
                } else {
                    railStrip
                }
            }
            .background(theme.app)
            // the grid runs to the window's foot, as the sidebar does
            .ignoresSafeArea(.container, edges: .bottom)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("automations-week")
        } else {
            phoneBody
        }
    }

    /// `RightRailStrip`: the folded rail, its icon and the vertical label.
    private var railStrip: some View {
        Button { railOpen = true } label: {
            VStack(spacing: 8) {
                DesktopIconView(icon: .calendarClock, size: 16)
                Text("Upcoming")
                    .font(theme.font(11))
                    .fixedSize()
                    .rotationEffect(.degrees(90))
                    .frame(width: 16, height: 70)
                Spacer(minLength: 0)
            }
            .foregroundStyle(theme.inkSecondary)
            .padding(.vertical, 16)
            .frame(width: 40)
            .frame(maxHeight: .infinity)
            .background(theme.panel)
            .overlay(alignment: .leading) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(width: 0.5) }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Show upcoming routines"))
        .accessibilityIdentifier("automations-rail-show")
    }

    private var phoneBody: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                HStack(spacing: 8) { header() }
                    .frame(maxWidth: 420)
                AnyView(navigation)
                Spacer(minLength: 0)
                if loading { ProgressView().controlSize(.small) }
                trailing()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
            HStack(spacing: 0) {
                AnyView(grid)
                Rectangle().fill(Theme.hairline).frame(width: 0.5)
                AnyView(desktop ? AnyView(desktopSide) : AnyView(side))
                    .frame(width: 280)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .accessibilityIdentifier("automations-week")
    }

    // MARK: Navigation

    private var navigation: some View {
        HStack(spacing: 8) {
            HStack(spacing: 0) {
                Button { day = RoutineCalendar.addDays(day, -7) } label: {
                    Image(systemName: "chevron.left").frame(width: 32, height: 32)
                }
                .accessibilityLabel(Text("Previous dates"))
                Button(String(localized: "Today")) { day = RoutineCalendar.startOfDay(Date()) }
                    .font(Theme.font(12, .medium))
                    .padding(.horizontal, 10)
                Button { day = RoutineCalendar.addDays(day, 7) } label: {
                    Image(systemName: "chevron.right").frame(width: 32, height: 32)
                }
                .accessibilityLabel(Text("Next dates"))
            }
            .foregroundStyle(Theme.textPrimary)
            .padding(2)
            .background(RoundedRectangle(cornerRadius: 8).fill(Theme.card))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.hairline, lineWidth: 0.5))
            Text(verbatim: rangeLabel)
                .font(Theme.font(15, .medium))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .padding(.horizontal, 8)
                .accessibilityIdentifier("automations-range")
        }
    }

    // MARK: Grid

    private var grid: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                // the gutter's head names the time zone (the desktop's "GMT-5")
                Text(verbatim: desktop ? Self.zoneLabel : "")
                    .font(desktop ? theme.font(12, .medium) : Theme.font(9.5))
                    .foregroundStyle(desktop ? theme.inkSecondary : Theme.textTertiary)
                    .frame(width: gutter, alignment: .center)
                    // the cell's py-3: its line at the top, beside the day names
                    .padding(.top, desktop ? 12 : 0)
                    .frame(maxHeight: .infinity, alignment: desktop ? .top : .center)
                    .overlay(alignment: .bottom) { Rectangle().fill(Theme.hairline.opacity(desktop ? 0.4 : 1)).frame(height: 0.5) }
                    .overlay(alignment: .trailing) { Rectangle().fill(Theme.hairline.opacity(desktop ? 0.4 : 1)).frame(width: 0.5) }
                ForEach(days, id: \.self) { date in
                    AnyView(dayHeader(date))
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            ScrollViewReader { reader in
                ScrollView {
                    HStack(alignment: .top, spacing: 0) {
                        hourLabels
                        ForEach(days, id: \.self) { date in
                            AnyView(column(date))
                        }
                    }
                    .frame(height: Self.hourHeight * 24)
                }
                .onAppear { scrollToStart(reader) }
                .onValueChange(of: weekStart) { _ in scrollToStart(reader) }
            }
        }
    }

    private func dayHeader(_ date: Date) -> some View {
        let today = Calendar.current.isDateInToday(date)
        return VStack(spacing: 4) {
            Text(verbatim: desktop ? date.formatted(.dateTime.weekday(.abbreviated)) : date.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                .font(Theme.font(desktop ? 11 : 10, .medium))
                .tracking(desktop ? 0 : 1.4)
                .foregroundStyle(today ? Theme.accent : Theme.textSecondary)
                // text-[11px] on a 16.5 line
                .frame(height: desktop ? 16.5 : nil)
            Text(verbatim: date.formatted(.dateTime.day()))
                .font(Theme.font(15, .medium))
                .foregroundStyle(today ? Color.white : Theme.textPrimary)
                .frame(width: 32, height: 32)
                .background(Circle().fill(today ? Theme.accent : Color.clear))
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background(today ? Theme.accent.opacity(0.035) : Color.clear)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.hairline.opacity(desktop ? 0.4 : 1)).frame(height: 0.5) }
        .overlay(alignment: .trailing) { Rectangle().fill(Theme.hairline.opacity(desktop ? 0.4 : 1)).frame(width: 0.5) }
        .accessibilityElement(children: .combine)
    }

    /// As the desktop opens a grid: two hours before now in this week, else 7 AM.
    private func scrollToStart(_ reader: ScrollViewProxy) {
        let thisWeek = days.contains { Calendar.current.isDateInToday($0) }
        let hour = thisWeek ? max(0, Calendar.current.component(.hour, from: Date()) - 2) : 7
        // the desktop scrolls `hour * HOUR_HEIGHT` with its day header inside
        // the scroller: the grid shows from about an hour earlier
        reader.scrollTo("week-hour-\(desktop ? max(0, hour - 1) : hour)", anchor: .top)
    }

    private var hourLabels: some View {
        VStack(spacing: 0) {
            ForEach(0..<24, id: \.self) { hour in
                // the desktop's label sits on its line (`-translate-y-1/2`)
                Color.clear
                    .frame(width: gutter, height: Self.hourHeight)
                    .overlay(alignment: .topTrailing) {
                        Text(verbatim: hour == 0 ? "" : AutomationsCalendarView<EmptyView>.hourText(hour))
                            .font(desktop ? theme.font(11) : Theme.font(9.5))
                            .monospacedDigit()
                            .foregroundStyle(Theme.textTertiary)
                            .fixedSize()
                            .alignmentGuide(.top) { $0[VerticalAlignment.center] }
                            .padding(.trailing, 8)
                    }
                    .id("week-hour-\(hour)")
            }
        }
        .overlay(alignment: .trailing) { if desktop { Rectangle().fill(theme.hairline.opacity(0.4)).frame(width: 0.5) } }
        .accessibilityHidden(true)
    }

    private func column(_ date: Date) -> some View {
        let items = RoutineCalendar.day(date, routines: routines, runs: runs, botId: botId)
        let layouts = RoutineCalendar.pack(items)
        let today = Calendar.current.isDateInToday(date)
        return GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                VStack(spacing: 0) {
                    ForEach(0..<24, id: \.self) { hour in
                        ZStack(alignment: .top) {
                            Rectangle().fill(Theme.hairline.opacity(0.75)).frame(height: 0.5)
                            Rectangle().fill(Theme.hairline.opacity(0.25)).frame(height: 0.5).offset(y: Self.hourHeight / 2)
                        }
                        .frame(maxWidth: .infinity, minHeight: Self.hourHeight, maxHeight: Self.hourHeight, alignment: .top)
                        .contentShape(Rectangle())
                        // 8d5344283: on the desktop a plain click no longer
                        // creates; a drag or a right-click does. Here a
                        // long press is the right-click (a drag scrolls).
                        .gesture(SpatialTapGesture().onEnded { value in
                            let minutes = Double(hour) * 60 + Double(value.location.y / Self.hourHeight) * 60
                            onCreate(RoutineCalendar.slot(day: date, minutes: minutes))
                        }, including: desktop ? .none : .all)
                        .onLongPressGesture(minimumDuration: 0.45) {
                            if desktop { onCreate(RoutineCalendar.slot(day: date, minutes: Double(hour) * 60)) }
                        }
                        .accessibilityElement()
                        .accessibilityLabel(Text(verbatim: "\(date.formatted(.dateTime.weekday(.wide))) \(AutomationsCalendarView<EmptyView>.hourText(hour))"))
                        .accessibilityAddTraits(.isButton)
                        .accessibilityAction { onCreate(RoutineCalendar.slot(day: date, minutes: Double(hour) * 60)) }
                    }
                }
                if today { nowLine }
                ForEach(items) { item in
                    let layout = layouts[item.id] ?? RoutineCalendarLayout(column: 0, columns: 1)
                    let width = proxy.size.width / CGFloat(layout.columns)
                    let parts = Calendar.current.dateComponents([.hour, .minute], from: item.date)
                    let top = CGFloat((parts.hour ?? 0) * 60 + (parts.minute ?? 0)) / 60 * Self.hourHeight
                    AutomationsEventCard(item: item, bot: item.botId.flatMap { id in bots.first { $0.id == id } }, compact: desktop)
                        .frame(width: max(0, width - 4), height: max(16, CGFloat(item.durationMinutes) / 60 * Self.hourHeight))
                        .offset(x: CGFloat(layout.column) * width + 2, y: top)
                        .onTapGesture { onAction(.open, item) }
                        .contextMenu { menu(item) }
                }
            }
        }
        .frame(maxWidth: .infinity)
        .background(today ? Theme.accent.opacity(0.035) : Color.clear)
        .overlay(alignment: .trailing) { Rectangle().fill(Theme.hairline.opacity(0.5)).frame(width: 0.5) }
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

    @ViewBuilder
    private func menu(_ item: RoutineCalendarItem) -> some View {
        if item.run != nil {
            Button(String(localized: "Open run"), systemImage: "doc.text") { onAction(.open, item) }
        }
        if item.canMove {
            Button(String(localized: "Reschedule"), systemImage: "calendar.badge.clock") { onAction(.reschedule, item) }
        }
        if let routine = item.routine {
            Button(String(localized: "Edit"), systemImage: "pencil") { onAction(.edit, item) }
            Button(String(localized: "Run now"), systemImage: "play.fill") { onAction(.runNow, item) }
            if routine.canToggle() {
                Button(routine.enabled ? String(localized: "Pause") : String(localized: "Resume"),
                       systemImage: routine.enabled ? "pause" : "play") { onAction(.toggle, item) }
            }
            Button(String(localized: "Run logs"), systemImage: "list.bullet.rectangle") { onAction(.logs, item) }
        }
    }

    /// "Today at 7:02 AM", "Tomorrow at 7:02 AM", else the date and time.
    static func whenText(_ date: Date) -> Text {
        let time = date.formatted(date: .omitted, time: .shortened)
        if Calendar.current.isDateInToday(date) { return Text("Today at \(time)") }
        if Calendar.current.isDateInTomorrow(date) { return Text("Tomorrow at \(time)") }
        return Text("\(date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())) at \(time)")
    }

    /// "GMT-5": the zone's offset as the desktop's calendar heads it.
    static var zoneLabel: String {
        let seconds = TimeZone.current.secondsFromGMT()
        let hours = seconds / 3600, minutes = abs(seconds % 3600) / 60
        return minutes == 0 ? "GMT\(hours >= 0 ? "+" : "")\(hours)" : String(format: "GMT%+d:%02d", hours, minutes)
    }

    // MARK: Side (the desktop's: the month, Upcoming, the drag hint)

    private var upcoming: [RoutineCalendarItem] {
        let now = Date()
        let soon = (0..<14).flatMap { RoutineCalendar.day(RoutineCalendar.addDays(RoutineCalendar.startOfDay(now), $0), routines: routines, runs: runs, botId: botId) }
        // one row per routine, its next run (the desktop's Upcoming)
        var seen = Set<String>()
        return Array(soon.filter { $0.date >= now && $0.run == nil }.sorted { $0.date < $1.date }.filter { item in
            seen.insert(item.routine?.id ?? item.id).inserted
        }.prefix(8))
    }

    /// `CalendarSidebar` in `RightRailPanel`: the › fold button, the month,
    /// a hairline, Upcoming with its count, the drag hint.
    private var desktopSide: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Button { railOpen = false } label: {
                    DesktopIconView(icon: .chevronRight, size: 16)
                        .foregroundStyle(theme.inkSecondary)
                        .padding(4)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Hide upcoming routines"))
                .accessibilityIdentifier("automations-rail-hide")
                Spacer()
            }
            .padding(.horizontal, 8)
            .padding(.top, 8)
            DesktopMiniMonth(day: $day)
                .padding(12)
            // `mx-4 border-t border-hairline/40`
            Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1).padding(.horizontal, 16)
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    DesktopIconView(icon: .calendarClock, size: 13)
                    Text("Upcoming").font(theme.font(12, .medium))
                    Spacer()
                    Text(verbatim: "\(upcoming.count)")
                        .font(theme.font(11)).monospacedDigit()
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Capsule().fill(theme.raised))
                }
                .foregroundStyle(theme.inkSecondary)
                .padding(.horizontal, 4)
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(upcoming) { item in
                            Button { onAction(.open, item) } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    // RoutineList variant "upcoming": 13/18, the when line 13/18 secondary
                                    Text(verbatim: item.name).font(theme.font(13)).foregroundStyle(theme.ink).lineLimit(1)
                                    HStack(spacing: 4) {
                                        if let bot = item.botId.flatMap({ id in bots.first { $0.id == id } }) {
                                            BotMascotView(bot: bot, size: 14).frame(width: 14, height: 14)
                                            Text(verbatim: bot.name)
                                        }
                                        Text(verbatim: "· ") + Self.whenText(item.date)
                                    }
                                    .font(theme.font(13)).foregroundStyle(theme.inkSecondary).lineLimit(1)
                                }
                                .padding(.horizontal, 4)
                                .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                Text("Drag a bot from the left sidebar onto a time to schedule it.")
                    .font(theme.font(11))
                    .foregroundStyle(theme.inkTertiary)
                    .padding(.horizontal, 8)
            }
            .padding(.horizontal, 12)
            .padding(.top, 12)
            .padding(.bottom, 12)
        }
    }

    // MARK: Side

    private var side: some View {
        let shown = bots.filter { $0.hidden != true }
            .filter { botQuery.isEmpty || $0.name.localizedCaseInsensitiveContains(botQuery) || $0.title.localizedCaseInsensitiveContains(botQuery) }
        return ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                DatePicker(
                    String(localized: "Date"),
                    selection: Binding(get: { day }, set: { day = RoutineCalendar.startOfDay($0) }),
                    displayedComponents: .date
                )
                .datePickerStyle(.graphical)
                .labelsHidden()
                .tint(Theme.accent)
                .scaleEffect(0.92, anchor: .top)
                .frame(height: 300, alignment: .top)
                HStack {
                    Label(String(localized: "My bots"), systemImage: "person.2")
                        .font(Theme.font(11, .semibold))
                        .textCase(.uppercase)
                        .foregroundStyle(Theme.textSecondary)
                    Spacer()
                    Text(verbatim: "\(shown.count)").font(Theme.font(10)).foregroundStyle(Theme.textSecondary)
                }
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    TextField(String(localized: "Search bots"), text: $botQuery)
                        .font(Theme.font(12))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                .padding(.horizontal, 8)
                .frame(height: 30)
                .background(RoundedRectangle(cornerRadius: 8).fill(Theme.card))
                ForEach(shown) { bot in
                    HStack(spacing: 8) {
                        BotMascotView(bot: bot, size: 24).frame(width: 24, height: 24)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(verbatim: bot.name).font(Theme.font(12, .medium)).foregroundStyle(Theme.textPrimary).lineLimit(1)
                            if !bot.title.isEmpty {
                                Text(verbatim: bot.title).font(Theme.font(10)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 2)
                }
            }
            .padding(12)
        }
    }
}

/// The desktop's mini month (RoutineCalendarPage.tsx `MiniMonth`): the
/// month and year with ‹ ›, the weekday initials from Monday, the days in a
/// seven-column grid, today in the accent circle, the shown week tinted;
/// a day opens its week.
struct DesktopMiniMonth: View {
    @Environment(\.themePalette) var themePalette
    @Binding var day: Date
    @State private var month: Date = RoutineCalendar.startOfDay(Date())

    private var calendar: Calendar {
        var c = Calendar.current
        c.firstWeekday = 2
        return c
    }

    private var monthStart: Date { calendar.date(from: calendar.dateComponents([.year, .month], from: month)) ?? month }

    private var cells: [Date] {
        let first = monthStart
        let lead = (calendar.component(.weekday, from: first) + 5) % 7
        let start = RoutineCalendar.addDays(first, -lead)
        return (0..<42).map { RoutineCalendar.addDays(start, $0) }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(verbatim: monthStart.formatted(.dateTime.month(.wide).year()))
                    .font(Theme.font(13, .semibold)).foregroundStyle(Theme.textPrimary)
                Spacer()
                HStack(spacing: 2) {
                    Button { month = calendar.date(byAdding: .month, value: -1, to: monthStart) ?? month } label: {
                        DesktopIconView(icon: .chevronLeft, size: 15).frame(width: 28, height: 28).contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Previous month"))
                    Button { month = calendar.date(byAdding: .month, value: 1, to: monthStart) ?? month } label: {
                        DesktopIconView(icon: .chevronRight, size: 15).frame(width: 28, height: 28).contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Next month"))
                }
            }
            .foregroundStyle(Theme.textSecondary)
            .padding(.horizontal, 4)
            .padding(.bottom, 8)
            // MiniMonth.tsx's WEEKDAY_LABELS, Monday first
            HStack(spacing: 0) {
                ForEach(Array(["M", "T", "W", "T", "F", "S", "S"].enumerated()), id: \.offset) { _, letter in
                    Text(verbatim: letter)
                        .font(Theme.font(11, .medium)).foregroundStyle(Theme.textTertiary)
                        .frame(maxWidth: .infinity, minHeight: 24)
                }
            }
            .accessibilityHidden(true)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 7), spacing: 2) {
                ForEach(cells, id: \.self) { date in
                    let inMonth = calendar.isDate(date, equalTo: monthStart, toGranularity: .month)
                    let today = calendar.isDateInToday(date)
                    // the anchor day is filled, today is in the accent's ink
                    let selected = calendar.isDate(date, inSameDayAs: day)
                    Button { day = RoutineCalendar.startOfDay(date) } label: {
                        Text(verbatim: date.formatted(.dateTime.day()))
                            .font(Theme.font(11, selected || today ? .semibold : .regular))
                            .foregroundStyle(selected ? Color.white : today ? Theme.accent : (inMonth ? Theme.textPrimary : Theme.textTertiary))
                            .frame(width: 24, height: 24)
                            .background(Circle().fill(selected ? Theme.accent : Color.clear))
                            .frame(maxWidth: .infinity, minHeight: 28)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(verbatim: date.formatted(.dateTime.weekday(.wide).month(.wide).day().year())))
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
        }
        .onAppear { month = day }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("automations-mini-month")
    }
}
