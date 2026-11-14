import XCTest

/// Screenshots a run keeps outside the result bundle: when the runner gets
/// SAGAX_SHOTS (TEST_RUNNER_SAGAX_SHOTS), each one is also written there as
/// a PNG, so a review reads them without opening the .xcresult.
/// With SAGAX_SHOTS_HOST=1 the host takes the PNG instead (`simctl io
/// screenshot`): the test leaves `<name>.want` there and waits until the
/// host removes it. A landscape iPad's XCUITest screenshot is drawn turned
/// and cut, simctl's is not.
enum ParityShots {
    static func save(_ name: String, _ app: XCUIApplication) {
        guard let dir = ProcessInfo.processInfo.environment["SAGAX_SHOTS"], !dir.isEmpty else { return }
        let folder = URL(fileURLWithPath: dir, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = name.lowercased().map { $0.isLetter || $0.isNumber ? $0 : "-" }
        if ProcessInfo.processInfo.environment["SAGAX_SHOTS_HOST"] == "1" {
            let want = folder.appendingPathComponent(String(file) + ".want")
            FileManager.default.createFile(atPath: want.path, contents: nil)
            let deadline = Date().addingTimeInterval(20)
            while FileManager.default.fileExists(atPath: want.path), Date() < deadline { Thread.sleep(forTimeInterval: 0.2) }
            return
        }
        try? app.screenshot().pngRepresentation.write(to: folder.appendingPathComponent(String(file) + ".png"))
    }
}
