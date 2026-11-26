import Foundation

/// The release this app runs, said to the server on every request
/// (owner 2026-11-26, D-20261126-004). URLSession's own User-Agent names the
/// build only ("Sagax/234 CFNetwork/..."), so the server could tell an app
/// older than its minimum from a build number written there, release by
/// release (server/app-update-gate.ts). With this header it reads the
/// release itself, and asks an app that is too old to update before it sends.
public enum AppRelease {
    /// The request header that carries the release (X.Y.Z).
    public static let header = "x-sagax-app-version"

    /// The release a bundle names, or nil when it names none that reads as
    /// X.Y.Z (a test host, a development tool): nothing is sent then.
    public static func current(info: [String: Any]? = Bundle.main.infoDictionary) -> String? {
        guard let raw = info?["CFBundleShortVersionString"] as? String else { return nil }
        let parts = raw.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, parts.allSatisfy({ !$0.isEmpty && $0.count <= 9 && $0.allSatisfy(\.isASCII) && $0.allSatisfy(\.isNumber) }) else { return nil }
        return raw
    }
}
