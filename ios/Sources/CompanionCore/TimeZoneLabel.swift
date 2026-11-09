import Foundation

/// A time zone's human name for a field that is too narrow for the IANA id:
/// "Eastern Time" for America/Toronto or America/New_York, "Pacific Time" for
/// America/Vancouver. Falls back to the city ("Reykjavik") when the system has
/// no generic name, and to the id itself when it is not a known zone.
public enum TimeZoneLabel {
    public static func human(_ id: String, locale: Locale = Locale(identifier: "en_US")) -> String {
        guard let zone = TimeZone(identifier: id) else { return id.replacingOccurrences(of: "_", with: " ") }
        if id == "UTC" || id == "GMT" { return "UTC" }
        if let name = zone.localizedName(for: .generic, locale: locale), !name.isEmpty, !name.hasPrefix("GMT") {
            return name
        }
        return city(id)
    }

    /// "Eastern Time (America/Toronto)": the name and the id, for a menu row.
    public static func detailed(_ id: String, locale: Locale = Locale(identifier: "en_US")) -> String {
        let name = human(id, locale: locale)
        let raw = id.replacingOccurrences(of: "_", with: " ")
        return name == raw ? raw : "\(name) (\(raw))"
    }

    static func city(_ id: String) -> String {
        (id.split(separator: "/").last.map(String.init) ?? id).replacingOccurrences(of: "_", with: " ")
    }
}
