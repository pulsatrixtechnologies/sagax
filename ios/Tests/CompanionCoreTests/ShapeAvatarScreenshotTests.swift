// Rasterize path-bodied object presets via CompanionCore Path math into
// docs/screenshots/shape-engine-v2/ios-*.png when SHAPE_IOS_SHOTS=1.
// Same geometry the phone draws (ShapeAvatarOutline + evenodd fill).
import CompanionCore
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers
import XCTest

final class ShapeAvatarScreenshotTests: XCTestCase {
    func testWriteObjectPresetStillsWhenEnabled() throws {
        guard ProcessInfo.processInfo.environment["SHAPE_IOS_SHOTS"] == "1" else {
            throw XCTSkip("set SHAPE_IOS_SHOTS=1 to write ios-*.png evidence")
        }
        // .../ios/Tests/CompanionCoreTests/This.swift → repo root
        let out = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("docs/screenshots/shape-engine-v2", isDirectory: true)
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

        let sizes = [28, 48, 96]
        let fills: [String: (CGFloat, CGFloat, CGFloat)] = [
            "pad": (0.20, 0.70, 0.55),
            "cup": (0.95, 0.55, 0.20),
            "bulb": (0.95, 0.80, 0.20),
            "say": (0.35, 0.55, 0.95),
            "sprout": (0.30, 0.75, 0.35),
            "tin": (0.55, 0.35, 0.85),
            "tome": (0.75, 0.35, 0.45),
            "ship": (0.40, 0.45, 0.90),
        ]
        for preset in ShapeAvatarPresets.all {
            guard let id = preset.id, let rgb = fills[id] else { continue }
            let live = ShapeAvatarOutline.liveOutline(from: preset)
            XCTAssertTrue(live.pathBody, id)
            for size in sizes {
                let url = out.appendingPathComponent("ios-object-\(id)-\(size).png")
                try Self.writeStill(live: live, eyes: ShapeAvatarPresets.stillEyes(preset), size: size, rgb: rgb, to: url)
            }
        }
        // Moods: reuse cup/bulb/say at 96 with a tint note in filename.
        if let cup = ShapeAvatarPresets.byId("cup") {
            let live = ShapeAvatarOutline.liveOutline(from: cup)
            try Self.writeStill(live: live, eyes: ShapeAvatarPresets.stillEyes(cup), size: 96, rgb: (0.95, 0.55, 0.20), to: out.appendingPathComponent("ios-mood-happy-cup.png"))
        }
        if let bulb = ShapeAvatarPresets.byId("bulb") {
            let live = ShapeAvatarOutline.liveOutline(from: bulb)
            try Self.writeStill(live: live, eyes: ShapeAvatarPresets.stillEyes(bulb), size: 96, rgb: (0.95, 0.80, 0.20), to: out.appendingPathComponent("ios-mood-thinking-bulb.png"))
        }
        if let say = ShapeAvatarPresets.byId("say") {
            let live = ShapeAvatarOutline.liveOutline(from: say)
            try Self.writeStill(live: live, eyes: ShapeAvatarPresets.stillEyes(say), size: 96, rgb: (0.35, 0.55, 0.95), to: out.appendingPathComponent("ios-mood-sleep-say.png"))
        }
    }

    private static func writeStill(live: ShapeAvatarOutline.Live, eyes: [ShapeEyeBox], size: Int, rgb: (CGFloat, CGFloat, CGFloat), to url: URL) throws {
        let s = CGFloat(size)
        let scale: CGFloat = 2
        let px = Int(s * scale)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(
            data: nil, width: px, height: px, bitsPerComponent: 8, bytesPerRow: 0,
            space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            throw NSError(domain: "ShapeAvatarScreenshot", code: 1)
        }
        ctx.scaleBy(x: scale, y: scale)
        ctx.setFillColor(CGColor(red: 0.97, green: 0.97, blue: 0.98, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: s, height: s))
        // Box 0..100 → pixel space; flip Y for CoreGraphics.
        ctx.translateBy(x: 0, y: s)
        ctx.scaleBy(x: s / 100, y: -(s / 100))
        let path = CGMutablePath()
        Self.addSVGPath(live.path, to: path)
        for extra in live.extras { Self.addSVGPath(extra, to: path) }
        ctx.setFillColor(CGColor(red: rgb.0, green: rgb.1, blue: rgb.2, alpha: 1))
        ctx.addPath(path)
        ctx.fillPath(using: .evenOdd)
        // Eyes: the engine's pills, as the phone and the desktop draw them
        ctx.setFillColor(CGColor(red: 0.09, green: 0.09, blue: 0.11, alpha: 1))
        for e in eyes {
            let rect = CGRect(x: e.x - e.w / 2, y: e.y - e.h / 2, width: e.w, height: e.h)
            var turn = CGAffineTransform(translationX: e.x, y: e.y).rotated(by: e.tilt * .pi / 180).translatedBy(x: -e.x, y: -e.y)
            ctx.addPath(CGPath(roundedRect: rect, cornerWidth: e.w / 2, cornerHeight: e.w / 2, transform: &turn))
        }
        ctx.fillPath()
        guard let image = ctx.makeImage() else { throw NSError(domain: "ShapeAvatarScreenshot", code: 2) }
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            throw NSError(domain: "ShapeAvatarScreenshot", code: 3)
        }
        CGImageDestinationAddImage(dest, image, nil)
        XCTAssertTrue(CGImageDestinationFinalize(dest))
    }

    /// Minimal absolute M/L/C/Z parser for our preset paths.
    private static func addSVGPath(_ d: String, to path: CGMutablePath) {
        var i = d.startIndex
        var cmd: Character = "M"
        var nums: [CGFloat] = []
        func flush() {
            switch cmd {
            case "M" where nums.count >= 2:
                path.move(to: CGPoint(x: nums[0], y: nums[1]))
                var k = 2
                while k + 1 < nums.count {
                    path.addLine(to: CGPoint(x: nums[k], y: nums[k + 1])); k += 2
                }
            case "L" where nums.count >= 2:
                var k = 0
                while k + 1 < nums.count {
                    path.addLine(to: CGPoint(x: nums[k], y: nums[k + 1])); k += 2
                }
            case "C" where nums.count >= 6:
                var k = 0
                while k + 5 < nums.count {
                    path.addCurve(
                        to: CGPoint(x: nums[k + 4], y: nums[k + 5]),
                        control1: CGPoint(x: nums[k], y: nums[k + 1]),
                        control2: CGPoint(x: nums[k + 2], y: nums[k + 3])
                    )
                    k += 6
                }
            case "Z", "z":
                path.closeSubpath()
            default: break
            }
            nums.removeAll(keepingCapacity: true)
        }
        while i < d.endIndex {
            let ch = d[i]
            if ch.isLetter {
                flush()
                cmd = ch
                i = d.index(after: i)
                if cmd == "Z" || cmd == "z" { flush() }
                continue
            }
            if ch == "-" || ch == "+" || ch == "." || ch.isNumber {
                var j = i
                if d[j] == "-" || d[j] == "+" { j = d.index(after: j) }
                while j < d.endIndex && (d[j].isNumber || d[j] == ".") { j = d.index(after: j) }
                if let v = Double(d[i..<j]) { nums.append(CGFloat(v)) }
                i = j
                continue
            }
            i = d.index(after: i)
        }
        flush()
    }
}
