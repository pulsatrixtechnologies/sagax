import Foundation

/// The line Settings > About copies ("Copier la version", U2): the app, its
/// version and build, and the platform, so a bug report names the exact build.
public enum AppVersionText {
    public static func line(version: String, build: String, platform: String, osVersion: String) -> String {
        "Pulsatrix Sagax \(version) (\(build)) · \(platform) \(osVersion)"
    }
}
