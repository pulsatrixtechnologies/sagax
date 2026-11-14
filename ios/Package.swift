// swift-tools-version: 5.9
import PackageDescription

// CompanionCore is everything the phone knows that is not a view: the wire
// types, the SSE parser, the API client, and the fold that maintains state.
// It is a package rather than app-target source so it can be built and
// tested with `swift test` alone — no Xcode, no simulator, no signing —
// which is also what lets the decoding tests run against fixtures captured
// from a real harness.
let package = Package(
    name: "CompanionCore",
    // macOS 13 rather than 14: the core needs nothing newer than
    // URLSession.bytes (macOS 12), and `swift test` should run on whatever
    // Mac is to hand. The app's iOS 17 floor lives in project.yml.
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "CompanionCore", targets: ["CompanionCore"])
    ],
    targets: [
        // shape-engine.js: the open-bot-avatar engine with the desktop's
        // runtimeStill, run in JavaScriptCore for a person's own shape (#4159).
        .target(name: "CompanionCore", resources: [.copy("Resources/shape-engine.js")]),
        .testTarget(
            name: "CompanionCoreTests",
            dependencies: ["CompanionCore"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
