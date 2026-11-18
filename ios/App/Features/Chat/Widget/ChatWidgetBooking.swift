// The "Book a call" card (shared/widget-booking.ts), the desktop's
// WidgetBooking in SwiftUI: the meeting type with the person's own avatar, the
// bookings already on their calendar, the days that have a free slot and that
// day's times, five at a time. A time is a press of the Booking's own Button
// child (`book_slot`), which settles the card and has the bot book it with its
// calendar tool; the card then stays in place showing the booked time as
// confirmed. Days and times are written in the person's time zone and language.
import CompanionCore
import SwiftUI

extension ChatWidgetNode {
    /// Whether this tree holds a Booking, which shows its own answer instead of folding into a line.
    var containsBooking: Bool {
        type == "Booking" || children.contains { $0.containsBooking }
    }
}

enum ChatWidgetBookingFormat {
    static let timesShown = 5
    static let daysShown = 5
    static let upcomingShown = 3

    private static let parser: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static func instant(_ text: String) -> Date? { parser.date(from: text) ?? plain.date(from: text) }

    /// The person's zone when the bot named one, else the phone's own.
    static func zone(_ id: String?) -> TimeZone { id.flatMap(TimeZone.init(identifier:)) ?? .current }

    private static func format(_ date: Date, _ template: String, _ zone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.timeZone = zone
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter.string(from: date)
    }

    static func time(_ date: Date, _ zone: TimeZone) -> String { format(date, "jmm", zone) }
    static func shortDate(_ date: Date, _ zone: TimeZone) -> String { format(date, "MMMd", zone) }
    static func weekday(_ date: Date, _ zone: TimeZone) -> String { format(date, "EEE", zone) }
    static func dayNumber(_ date: Date, _ zone: TimeZone) -> String { format(date, "d", zone) }
    static func fullDate(_ date: Date, _ zone: TimeZone) -> String { format(date, "EEEMMMd", zone) }
    static func moment(_ date: Date, _ zone: TimeZone) -> String { format(date, "EEEMMMdjmm", zone) }

    /// "2026-11-09": the calendar day of an instant in the zone.
    static func dayKey(_ date: Date, _ zone: TimeZone) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// Today, tomorrow or neither, from the zone's own date.
    static func dayKind(_ key: String, now: Date, _ zone: TimeZone) -> String {
        if key == dayKey(now, zone) { return "today" }
        if key == dayKey(now.addingTimeInterval(86_400), zone) { return "tomorrow" }
        return "other"
    }
}

struct ChatWidgetBooking: View {
    let node: ChatWidgetNode
    @Environment(\.chatWidgetInk) private var ink
    @EnvironmentObject private var form: ChatWidgetForm
    @EnvironmentObject private var session: Session

    @State private var picked: String?
    @State private var windowStart = 0
    @State private var steps = 1

    private struct Slot: Identifiable {
        let ref: String
        let start: Date
        let label: String
        var id: String { ref }
    }

    private struct Day: Identifiable {
        let key: String
        let at: Date
        var slots: [Slot]
        var id: String { key }
    }

    private var zone: TimeZone { ChatWidgetBookingFormat.zone(node.string("timeZone")) }

    private var slots: [Slot] {
        node.children.compactMap { child in
            guard child.type == "Button",
                  let text = child["onClickAction"]?.object?["payload"]?.object?["start"]?.string,
                  let start = ChatWidgetBookingFormat.instant(text) else { return nil }
            return Slot(ref: child.id, start: start, label: child.string("label") ?? "")
        }
    }

    private var days: [Day] {
        var byKey: [String: Day] = [:]
        for slot in slots.sorted(by: { $0.start < $1.start }) {
            let key = ChatWidgetBookingFormat.dayKey(slot.start, zone)
            byKey[key, default: Day(key: key, at: slot.start, slots: [])].slots.append(slot)
        }
        return byKey.values.sorted { $0.key < $1.key }
    }

    var body: some View {
        let days = days
        let chosen = form.settledRef.flatMap { ref in slots.first { $0.ref == ref } }
        let chosenDay = chosen.flatMap { slot in days.first { $0.slots.contains { $0.ref == slot.ref } } }
        if let day = chosenDay ?? days.first(where: { $0.key == picked }) ?? days.first {
            content(days: days, day: day, chosen: chosen)
        }
    }

    @ViewBuilder
    private func content(days: [Day], day: Day, chosen: Slot?) -> some View {
        // pressed, then booked only when the calendar tool said so: until then it is only being booked
        let confirmed = chosen != nil && form.booking?.state == "booked"
        let booked = confirmed ? chosen : nil
        let booking = confirmed ? nil : chosen
        let dayIndex = days.firstIndex { $0.key == day.key } ?? 0
        let shown = Array(day.slots.prefix(ChatWidgetBookingFormat.timesShown * steps))
        let hasMoreInDay = shown.count < day.slots.count
        let nextDay = dayIndex + 1 < days.count ? days[dayIndex + 1] : nil
        let canMore = chosen == nil && (hasMoreInDay || nextDay != nil)
        let start = min(max(0, windowStart), max(0, days.count - ChatWidgetBookingFormat.daysShown))
        let tiles = Array(days.dropFirst(start).prefix(ChatWidgetBookingFormat.daysShown))
        let overflow = days.count > ChatWidgetBookingFormat.daysShown
        VStack(alignment: .leading, spacing: 16) {
            header
            meeting
            upcoming
            HStack(spacing: 6) {
                if overflow {
                    stepper("chevron.left", label: String(localized: "Earlier days"), enabled: start > 0) { windowStart = max(0, start - 1) }
                }
                HStack(spacing: 8) {
                    ForEach(tiles) { tile in dayTile(tile, selected: tile.key == day.key, locked: chosen != nil) }
                }
                if overflow {
                    stepper("chevron.right", label: String(localized: "Later days"), enabled: start + ChatWidgetBookingFormat.daysShown < days.count) {
                        windowStart = start + 1
                    }
                }
            }
            ChatWidgetFlow(spacing: 8) {
                ForEach(shown) { slot in chip(slot, chosen: chosen, confirmed: confirmed) }
            }
            HStack(spacing: 12) {
                if let booking {
                    Label {
                        Text("Booking \(ChatWidgetBookingFormat.moment(booking.start, zone))…")
                    } icon: {
                        ProgressView().controlSize(.small)
                    }
                    .font(ink.font(13))
                    .foregroundStyle(ink.secondary)
                    .lineLimit(1)
                    .accessibilityIdentifier("widget-booking-pending")
                } else if let booked {
                    Label {
                        Text("Booked · \(ChatWidgetBookingFormat.moment(booked.start, zone))")
                    } icon: {
                        Image(systemName: "calendar.badge.checkmark")
                    }
                    .font(ink.font(13, .medium))
                    .foregroundStyle(ink.success)
                    .lineLimit(1)
                    .accessibilityIdentifier("widget-booking-confirmed")
                } else {
                    Text(verbatim: dayLine(day))
                        .font(ink.font(13))
                        .foregroundStyle(ink.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                if canMore {
                    Button {
                        if hasMoreInDay {
                            steps += 1
                        } else if let nextDay {
                            picked = nextDay.key
                            steps = 1
                            if let at = days.firstIndex(where: { $0.key == nextDay.key }), at >= start + ChatWidgetBookingFormat.daysShown {
                                windowStart = at - ChatWidgetBookingFormat.daysShown + 1
                            }
                        }
                    } label: {
                        Text("More times")
                            .font(ink.font(14, .medium))
                            .foregroundStyle(ink.ink)
                            .padding(.horizontal, 16)
                            .frame(minHeight: 44)
                            .background(ink.ink.opacity(0.07), in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(form.locked)
                    .accessibilityIdentifier("widget-booking-more")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: node.string("title") ?? String(localized: "Book a call")))
        .accessibilityIdentifier("widget-booking-\(node.id)")
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "calendar")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(ink.secondary)
                .frame(width: 32, height: 32)
                .background(ink.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityHidden(true)
            Text(verbatim: node.string("title") ?? String(localized: "Book a call"))
                .font(ink.font(15, .semibold))
                .foregroundStyle(ink.ink)
                .lineLimit(1)
        }
    }

    private var meeting: some View {
        let minutes = node.integer("durationMinutes", in: 1...1_440)
        let detail = node.string("detail") ?? minutes.map { String(localized: "\($0) min") }
        return HStack(spacing: 12) {
            ProfileAvatar(name: session.connection?.name ?? "You", size: 36)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: node.string("meetingType") ?? String(localized: "Meeting"))
                    .font(ink.font(14, .medium))
                    .foregroundStyle(ink.ink)
                    .lineLimit(1)
                if let detail {
                    Text(verbatim: detail)
                        .font(ink.font(12.5))
                        .foregroundStyle(ink.secondary)
                        .lineLimit(1)
                }
            }
        }
    }

    @ViewBuilder
    private var upcoming: some View {
        let items = (node["upcoming"]?.array ?? []).compactMap { item -> (name: String, start: Date)? in
            guard let name = item.object?["name"]?.string, let start = item.object?["start"]?.string.flatMap(ChatWidgetBookingFormat.instant) else { return nil }
            return (name, start)
        }
        let listed = Array(items.prefix(ChatWidgetBookingFormat.upcomingShown))
        let rest = max(0, items.count - listed.count) + (node.integer("upcomingMore", in: 0...999) ?? 0)
        if !listed.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("Upcoming bookings")
                    .font(ink.font(12, .medium))
                    .foregroundStyle(ink.tertiary)
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(listed.enumerated()), id: \.offset) { _, item in
                        (Text(verbatim: item.name).fontWeight(.semibold).foregroundColor(ink.ink)
                            + Text(verbatim: " · ")
                            + Text("\(ChatWidgetBookingFormat.shortDate(item.start, zone)) at \(ChatWidgetBookingFormat.time(item.start, zone))"))
                            .font(ink.font(13))
                            .foregroundStyle(ink.secondary)
                            .lineLimit(1)
                    }
                }
                if rest > 0 {
                    Text("and \(rest) more")
                        .font(ink.font(13))
                        .foregroundStyle(ink.tertiary)
                }
            }
        }
    }

    private func dayTile(_ day: Day, selected: Bool, locked: Bool) -> some View {
        Button {
            picked = day.key
            steps = 1
        } label: {
            VStack(spacing: 2) {
                Text(verbatim: ChatWidgetBookingFormat.weekday(day.at, zone)).font(ink.font(12))
                Text(verbatim: ChatWidgetBookingFormat.dayNumber(day.at, zone)).font(ink.font(16, .semibold)).monospacedDigit()
            }
            .foregroundStyle(selected ? ink.ink : ink.secondary)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(selected ? ink.ink.opacity(0.09) : Color.clear, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(selected ? Color.clear : ink.ring, lineWidth: 1))
            .opacity(locked && !selected ? 0.6 : 1)
        }
        .buttonStyle(.plain)
        .disabled(locked)
        .accessibilityLabel(Text(verbatim: ChatWidgetBookingFormat.fullDate(day.at, zone)))
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("widget-booking-day-\(day.key)")
    }

    private func chip(_ slot: Slot, chosen: Slot?, confirmed: Bool) -> some View {
        let picked = chosen?.ref == slot.ref
        let waiting = picked && !confirmed
        let enabled = picked || form.canPress(form.actions[slot.ref])
        return Button {
            form.press(slot.ref)
        } label: {
            HStack(spacing: 4) {
                if picked && confirmed { Image(systemName: "calendar.badge.checkmark").font(.system(size: 12)) }
                if waiting { ProgressView().controlSize(.mini) }
                if waiting {
                    Text("Booking…").font(ink.font(14, .medium))
                } else {
                    Text(verbatim: ChatWidgetBookingFormat.time(slot.start, zone)).font(ink.font(14, .medium)).monospacedDigit()
                }
            }
            .foregroundStyle(picked && confirmed ? ink.accentInk : ink.ink)
            .padding(.horizontal, 14)
            .frame(minWidth: 72, minHeight: 44)
            .background(picked && confirmed ? ink.accent : waiting ? ink.ink.opacity(0.09) : Color.clear, in: Capsule())
            .overlay(Capsule().strokeBorder(picked && confirmed ? Color.clear : ink.ring, lineWidth: 1))
            .opacity(chosen != nil && !picked ? 0.45 : 1)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(Text(verbatim: slot.label))
        .accessibilityAddTraits(picked ? .isSelected : [])
        .accessibilityIdentifier("widget-booking-slot-\(slot.ref)")
    }

    private func stepper(_ symbol: String, label: String, enabled: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(ink.secondary)
                .frame(width: 28, height: 44)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.3)
        .accessibilityLabel(Text(verbatim: label))
    }

    private func dayLine(_ day: Day) -> String {
        let date = ChatWidgetBookingFormat.shortDate(day.at, zone)
        switch ChatWidgetBookingFormat.dayKind(day.key, now: Date(), zone) {
        case "today": return String(localized: "Today · \(date)")
        case "tomorrow": return String(localized: "Tomorrow · \(date)")
        default: return String(localized: "\(ChatWidgetBookingFormat.weekday(day.at, zone)) · \(date)")
        }
    }
}
