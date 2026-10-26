import Foundation

/// Human wording for cron expressions: lists, ranges, steps, day names, day of
/// month and months, in French or English. A port of `shared/cron-describe.ts`
/// (same sentences, same cases it refuses). Presentation only: nil means the
/// expression cannot be said without guessing, so the caller shows it raw.
public enum CronDescribe {
    public enum Language: String, Sendable { case en, fr }

    /// The language the phone's UI uses: French or English.
    public static var currentLanguage: Language {
        (Locale.current.language.languageCode?.identifier ?? "en") == "fr" ? .fr : .en
    }

    private struct Field {
        var values: [Int]
        var star: Bool
        var step: Int?
        var rangeStart: Int?
        var rangeEnd: Int?
    }

    private static let monthNames: [Language: [String]] = [
        .en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
        .fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
    ]
    private static let dayNames: [Language: [String]] = [
        .en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        .fr: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"],
    ]
    private static let monthAliases = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
    private static let dayAliases = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

    private static func aliasValue(_ token: String, _ aliases: [String], _ offset: Int) -> Int? {
        if !token.isEmpty, token.allSatisfy({ $0.isASCII && $0.isNumber }) { return Int(token) }
        return aliases.firstIndex(of: token.uppercased()).map { $0 + offset }
    }

    private static func parseField(_ text: String, _ min: Int, _ max: Int, aliases: [String] = [], offset: Int = 0) -> Field? {
        var values = Set<Int>()
        let parts = text.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
        var single: (step: Int?, start: Int?, end: Int?)?
        for part in parts {
            let pieces = part.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
            guard pieces.count <= 2, let rangePart = pieces.first, !rangePart.isEmpty else { return nil }
            var step = 1
            if pieces.count == 2 {
                guard !pieces[1].isEmpty, pieces[1].allSatisfy({ $0.isASCII && $0.isNumber }), let parsed = Int(pieces[1]), parsed >= 1 else { return nil }
                step = parsed
            }
            let hasStep = pieces.count == 2
            var start: Int
            var end: Int
            if rangePart == "*" {
                start = min; end = max
            } else if rangePart.contains("-") {
                let bounds = rangePart.split(separator: "-", omittingEmptySubsequences: false).map(String.init)
                guard bounds.count == 2, let first = aliasValue(bounds[0], aliases, offset), let last = aliasValue(bounds[1], aliases, offset) else { return nil }
                start = first; end = last
            } else {
                guard let value = aliasValue(rangePart, aliases, offset) else { return nil }
                start = value
                end = hasStep ? max : value
            }
            guard start >= min, end <= max, start <= end else { return nil }
            var value = start
            while value <= end { values.insert(value); value += step }
            single = parts.count == 1
                ? (hasStep ? step : nil, rangePart == "*" ? nil : start, rangePart == "*" ? nil : end)
                : nil
        }
        return Field(values: values.sorted(), star: text == "*", step: single?.step, rangeStart: single?.start, rangeEnd: single?.end)
    }

    private static func join(_ items: [String], _ language: Language) -> String {
        guard items.count > 1 else { return items.first ?? "" }
        let word = language == .fr ? "et" : "and"
        return "\(items.dropLast().joined(separator: ", ")) \(word) \(items[items.count - 1])"
    }

    private static func isContiguous(_ values: [Int]) -> Bool {
        zip(values, values.dropFirst()).allSatisfy { $1 == $0 + 1 }
    }

    /// "8 AM" / "8 h" on the hour, "8:30 AM" / "8 h 30" otherwise.
    private static func clock(_ hour: Int, _ minute: Int, _ language: Language, forceMinutes: Bool = false) -> String {
        let mm = String(format: "%02d", minute)
        if language == .fr { return minute == 0 && !forceMinutes ? "\(hour) h" : "\(hour) h \(mm)" }
        let h12 = hour % 12 == 0 ? 12 : hour % 12
        let suffix = hour < 12 ? "AM" : "PM"
        return minute == 0 && !forceMinutes ? "\(h12) \(suffix)" : "\(h12):\(mm) \(suffix)"
    }

    private static func past(_ minutes: [Int]) -> [String] { minutes.map { ":" + String(format: "%02d", $0) } }

    private static func daysPhrase(_ dow: Field, _ language: Language) -> String {
        let days = Array(Set(dow.values.map { $0 % 7 })).sorted()
        if days.count == 7 { return "" }
        let names = dayNames[language]!
        if days == [1, 2, 3, 4, 5] { return language == .fr ? "du lundi au vendredi" : "weekdays" }
        if days == [0, 6] { return language == .fr ? "les fins de semaine" : "weekends" }
        // Monday-first ordering, so Sunday closes a range (Friday to Sunday)
        let ordered = days.map { ($0 + 6) % 7 }.sorted()
        if days.count >= 3, isContiguous(ordered) {
            let first = names[(ordered[0] + 1) % 7]
            let last = names[(ordered[ordered.count - 1] + 1) % 7]
            return language == .fr ? "du \(first) au \(last)" : "\(first) to \(last)"
        }
        let list = ordered.map { names[($0 + 1) % 7] }
        if language == .fr { return days.count == 1 ? "le \(list[0])" : "les " + join(list.map { $0 + "s" }, language) }
        return days.count == 1 ? "\(list[0])s" : join(list, language)
    }

    private static func monthDayPhrase(_ dom: Field, _ language: Language) -> String {
        if language == .fr {
            return "le " + join(dom.values.map { $0 == 1 ? "1er" : String($0) }, language) + " du mois"
        }
        func ordinal(_ value: Int) -> String {
            let mod100 = value % 100
            if (11...13).contains(mod100) { return "\(value)th" }
            let suffixes = ["th", "st", "nd", "rd"]
            let mod10 = value % 10
            return "\(value)" + (mod10 < suffixes.count ? suffixes[mod10] : "th")
        }
        return "on the " + join(dom.values.map(ordinal), language)
    }

    public static func describe(_ expression: String, language: Language) -> String? {
        let fields = expression.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
        guard fields.count == 5 else { return nil }
        let allowed = Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz*,/-")
        guard fields.joined().allSatisfy({ allowed.contains($0) }) else { return nil }
        guard let minute = parseField(fields[0], 0, 59), let hour = parseField(fields[1], 0, 23),
              let dom = parseField(fields[2], 1, 31), let month = parseField(fields[3], 1, 12, aliases: monthAliases, offset: 1),
              let dow = parseField(fields[4], 0, 7, aliases: dayAliases, offset: 0)
        else { return nil }
        // Day of month and weekday together mean "either" in cron: not clear in a sentence.
        if !dom.star && !dow.star { return nil }

        let fr = language == .fr
        func everyN(_ n: Int, _ unit: String) -> String {
            fr ? "toutes les \(n) \(unit == "minutes" ? "minutes" : "heures")" : "every \(n) \(unit)"
        }
        let minutesFull = minute.star || (minute.step != nil && minute.rangeStart == nil && 60 % minute.step! == 0)
        func everyMinute() -> String {
            if let step = minute.step, step != 1 { return everyN(step, "minutes") }
            return fr ? "chaque minute" : "every minute"
        }
        if !minutesFull && minute.values.count > 12 { return nil }
        let minuteList = join(past(minute.values), language)
        let first = hour.values[0]
        let last = hour.values[hour.values.count - 1]
        let range = fr ? "de \(clock(first, 0, language)) à \(clock(last, 0, language))" : "\(clock(first, 0, language)) to \(clock(last, 0, language))"
        let atWord = fr ? "à" : "at"
        let when: String
        if hour.star {
            when = minutesFull ? everyMinute() : (fr ? "toutes les heures à \(minuteList)" : "every hour at \(minuteList)")
        } else if let step = hour.step, step > 1 {
            if minutesFull { return nil }
            let bounded = hour.rangeStart != nil && hour.rangeEnd != nil
            let onTheHour = minute.values == [0]
            when = [everyN(step, "hours"), bounded ? range : "", onTheHour ? "" : "\(atWord) \(minuteList)"].filter { !$0.isEmpty }.joined(separator: ", ")
        } else if hour.values.count > 1 && isContiguous(hour.values) {
            when = "\(range), " + (minutesFull ? everyMinute() : "\(atWord) \(minuteList)")
        } else {
            if minutesFull { return nil }
            var times: [String] = []
            for h in hour.values { for m in minute.values { times.append(clock(h, m, language, forceMinutes: true)) } }
            if times.count > 6 { return nil }
            when = "\(atWord) " + join(times, language)
        }

        var parts: [String] = []
        let days = dow.star ? "" : daysPhrase(dow, language)
        if !days.isEmpty { parts.append(days) }
        if !dom.star { parts.append(monthDayPhrase(dom, language)) }
        if !month.star {
            let names = month.values.map { monthNames[language]![$0 - 1] }
            parts.append((fr ? "en " : "in ") + join(names, language))
        }
        let text = parts.isEmpty ? when : parts.joined(separator: ", ") + ", " + when
        return text.prefix(1).uppercased() + text.dropFirst()
    }
}
