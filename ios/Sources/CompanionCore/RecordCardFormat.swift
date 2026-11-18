// How a record card words its times (#4572), the phone's copy of
// src/lib/record-card-format.ts. Every time is computed and written in the
// card's own zone (`tz`, the organization's), never the device's, in the
// person's language. A calendar day ("2026-11-05": a due date, an invoice
// date) is a day, not an instant: it has no time and no zone, so it is never
// shifted. `now` and the language are arguments so a test holds both still.
import Foundation

public enum RecordCardFormat {
    private static func locale(_ lang: String) -> Locale {
        Locale(identifier: lang.lowercased().hasPrefix("fr") ? "fr_CA" : (lang.isEmpty ? "en_US" : lang))
    }

    private static func zone(_ tz: String?) -> TimeZone {
        tz.flatMap { TimeZone(identifier: $0) } ?? .current
    }

    private static func calendar(_ tz: String?, _ lang: String) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone(tz)
        calendar.locale = locale(lang)
        return calendar
    }

    private static func utcCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    public static func isBareDay(_ value: String) -> Bool {
        value.trimmingCharacters(in: .whitespaces).range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
    }

    /// A bare day held at noon UTC: the same day on every device.
    static func bareDay(_ value: String) -> Date? {
        let parts = value.trimmingCharacters(in: .whitespaces).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return utcCalendar().date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    /// The instant an ISO 8601 text names; nil for a bare day.
    public static func instant(_ iso: String) -> Date? {
        let text = iso.replacingOccurrences(of: " ", with: "T")
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: text) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let date = plain.date(from: text) { return date }
        // an offset without a colon, or no offset at all (read as UTC)
        for format in ["yyyy-MM-dd'T'HH:mm:ssZ", "yyyy-MM-dd'T'HH:mm:ss.SSSZ", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm"] {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(identifier: "UTC")
            formatter.dateFormat = format
            if let date = formatter.date(from: text) { return date }
        }
        return nil
    }

    /// The calendar day of an instant in a zone, as a day number.
    private static func dayNumber(_ date: Date, _ tz: String?) -> Int {
        let parts = calendar(tz, "en").dateComponents([.year, .month, .day], from: date)
        let day = utcCalendar().date(from: DateComponents(year: parts.year, month: parts.month, day: parts.day, hour: 12))!
        return Int((day.timeIntervalSince1970 / 86_400).rounded(.down))
    }

    private static func dayNumber(ofBare value: String) -> Int {
        Int(((bareDay(value)?.timeIntervalSince1970 ?? 0) / 86_400).rounded(.down))
    }

    private static func namedDay(_ gap: Int, _ lang: String) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = locale(lang)
        formatter.dateTimeStyle = .named
        formatter.unitsStyle = .full
        return formatter.localizedString(from: DateComponents(day: gap))
    }

    private static func dayText(_ date: Date, _ lang: String, zone: TimeZone, year: Bool) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale(lang)
        formatter.timeZone = zone
        formatter.setLocalizedDateFormatFromTemplate(year ? "EEE d MMM y" : "EEE d MMM")
        return formatter.string(from: date)
    }

    private static func clock(_ date: Date, _ lang: String, _ tz: String?) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale(lang)
        formatter.timeZone = zone(tz)
        formatter.setLocalizedDateFormatFromTemplate("jm")
        return formatter.string(from: date)
    }

    /// The hour of "up to date at 2:32 PM": the clock time in the card's zone.
    public static func clockText(_ iso: String, lang: String, tz: String?) -> String {
        instant(iso).map { clock($0, lang, tz) } ?? ""
    }

    /// "yesterday 4:20 PM", "Wed, Nov 18, 5 PM", "tomorrow": a note's time and
    /// a due date. The year shows only when it is not this year's.
    public static func absolute(_ iso: String, now: Date, lang: String, tz: String?, time: Bool = true) -> String {
        if isBareDay(iso) {
            guard let day = bareDay(iso) else { return "" }
            let gap = dayNumber(ofBare: iso) - dayNumber(now, tz)
            if abs(gap) <= 1 { return namedDay(gap, lang) }
            let sameYear = utcCalendar().component(.year, from: day) == calendar(tz, lang).component(.year, from: now)
            return dayText(day, lang, zone: TimeZone(identifier: "UTC")!, year: !sameYear)
        }
        guard let date = instant(iso) else { return "" }
        let gap = dayNumber(date, tz) - dayNumber(now, tz)
        let at = time && iso.range(of: #"T\d"#, options: .regularExpression) != nil ? clock(date, lang, tz) : ""
        if abs(gap) <= 1 {
            let day = namedDay(gap, lang)
            return at.isEmpty ? day : "\(day) \(at)"
        }
        let cal = calendar(tz, lang)
        let sameYear = cal.component(.year, from: date) == cal.component(.year, from: now)
        let day = dayText(date, lang, zone: zone(tz), year: !sameYear)
        return at.isEmpty ? day : "\(day), \(at)"
    }

    /// "29 min ago", "3 days ago", "in 2 hours": an age or a last update.
    public static func relative(_ iso: String, now: Date, lang: String, tz: String?) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = locale(lang)
        if isBareDay(iso) {
            let gap = dayNumber(ofBare: iso) - dayNumber(now, tz)
            if gap == 0 { return namedDay(0, lang) }
            formatter.dateTimeStyle = .named
            formatter.unitsStyle = .full
            return formatter.localizedString(from: DateComponents(day: gap))
        }
        guard let then = instant(iso) else { return "" }
        let diff = then.timeIntervalSince(now)
        let magnitude = abs(diff)
        let sign: Double = diff < 0 ? -1 : 1
        formatter.dateTimeStyle = .numeric
        formatter.unitsStyle = .short
        if magnitude < 60 { formatter.dateTimeStyle = .named; return formatter.localizedString(from: DateComponents(second: 0)) }
        if magnitude < 3_600 { return formatter.localizedString(from: DateComponents(minute: Int(sign) * Int(magnitude / 60))) }
        if magnitude < 86_400 { return formatter.localizedString(from: DateComponents(hour: Int(sign) * Int(magnitude / 3_600))) }
        let days = Int(magnitude / 86_400)
        formatter.dateTimeStyle = .named
        formatter.unitsStyle = .full
        let signed = Int(sign) * days
        if days < 14 { return formatter.localizedString(from: DateComponents(day: signed)) }
        if days < 60 { return formatter.localizedString(from: DateComponents(weekOfYear: Int(sign) * (days / 7))) }
        if days < 540 { return formatter.localizedString(from: DateComponents(month: Int(sign) * (days / 30))) }
        return formatter.localizedString(from: DateComponents(year: Int(sign) * (days / 365)))
    }

    /// The full time with the zone's name: the long press of a relative time.
    public static func full(_ iso: String, lang: String, tz: String?) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale(lang)
        if isBareDay(iso) {
            formatter.timeZone = TimeZone(identifier: "UTC")
            formatter.dateStyle = .full
            formatter.timeStyle = .none
            return bareDay(iso).map { formatter.string(from: $0) } ?? ""
        }
        guard let date = instant(iso) else { return "" }
        formatter.timeZone = zone(tz)
        formatter.dateStyle = .full
        formatter.timeStyle = .short
        let name = zone(tz).abbreviation(for: date) ?? ""
        return name.isEmpty ? formatter.string(from: date) : "\(formatter.string(from: date)) (\(name))"
    }

    /// How late a past due date is: "2 days", "3h", "40m". A due day is late
    /// once that day is over in the card's zone, counted in whole days.
    public static func lateness(_ iso: String, now: Date, lang: String, tz: String?) -> String? {
        let formatter = DateComponentsFormatter()
        formatter.calendar = calendar(tz, lang)
        if isBareDay(iso) {
            let days = dayNumber(now, tz) - dayNumber(ofBare: iso)
            guard days >= 1 else { return nil }
            formatter.allowedUnits = [.day]
            formatter.unitsStyle = .full
            return formatter.string(from: DateComponents(day: days))
        }
        guard let due = instant(iso), due < now else { return nil }
        let late = now.timeIntervalSince(due)
        formatter.unitsStyle = .abbreviated
        if late >= 86_400 { formatter.allowedUnits = [.day]; formatter.unitsStyle = .full; return formatter.string(from: DateComponents(day: Int(late / 86_400))) }
        if late >= 3_600 { formatter.allowedUnits = [.hour]; return formatter.string(from: DateComponents(hour: Int(late / 3_600))) }
        formatter.allowedUnits = [.minute]
        return formatter.string(from: DateComponents(minute: max(1, Int(late / 60))))
    }

    /// A GUID is never a label.
    public static func isGuid(_ value: String) -> Bool {
        value.trimmingCharacters(in: .whitespaces).range(of: #"^\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?$"#, options: .regularExpression) != nil
    }
}
