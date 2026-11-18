// HD mascots (#968), the phone's `HdMascot` and `HdOrVector`
// (src/components/hd-mascots/HdMascot.tsx): a character's painted art in
// the box its vector look would take, while Settings > Appearance > HD
// mascots is on (`sagax.hdMascots.v1`, on by default, the desktop's key).
//
// - The art is the desktop's own files, bundled as they are (project.yml);
//   nothing decodes until a mascot draws it, at the pixel size it shows.
// - No blank, no layout shift: the vector drawing fills the box until the
//   asset has decoded; a loop that fails falls back on its still, a still
//   that fails on the vector drawing, for good.
// - Motion: a loop plays only when animated, the box is 48 pt or more and
//   Reduce Motion is off; otherwise the matching still shows. Under 48 pt
//   the still is cropped to head and shoulders. A still breathes a little
//   only where a loop could play (a large mascot), so lists cost nothing.
// - The art is painted: the bot's colour and skin tint the vector look only.
import CompanionCore
import ImageIO
import SwiftUI

/// One decoded asset: its frames and how long each shows (a still is one frame).
final class HdClip {
    let frames: [CGImage]
    let delays: [Double]
    let total: Double
    /// The file's own loop count (0: forever). The sad clip plays once and rests on its last frame.
    let loops: Int

    init(frames: [CGImage], delays: [Double], loops: Int) {
        self.frames = frames
        self.delays = delays
        total = delays.reduce(0, +)
        self.loops = loops
    }

    /// The frame `t` seconds into the clip.
    func frame(at t: Double) -> CGImage {
        guard frames.count > 1, total > 0 else { return frames[0] }
        if loops > 0, t >= total * Double(loops) { return frames[frames.count - 1] }
        var u = t.truncatingRemainder(dividingBy: total)
        for (i, d) in delays.enumerated() {
            if u < d { return frames[i] }
            u -= d
        }
        return frames[frames.count - 1]
    }
}

/// Decodes the bundled art once per file and pixel size; remembers failures.
enum HdArt {
    private static let cache = NSCache<NSString, HdClip>()
    private static var failed = Set<String>()
    private static let lock = NSLock()

    static func url(_ manifest: HdManifest, _ file: String) -> URL? {
        Bundle.main.url(forResource: file, withExtension: "webp", subdirectory: manifest.folder)
    }

    private static func key(_ manifest: HdManifest, _ file: String, _ pixels: Int) -> String { "\(manifest.folder)/\(file)@\(pixels)" }

    static func cached(_ manifest: HdManifest, _ file: String, pixels: Int) -> HdClip? {
        cache.object(forKey: key(manifest, file, pixels) as NSString)
    }

    static func hasFailed(_ manifest: HdManifest, _ file: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return failed.contains("\(manifest.folder)/\(file)")
    }

    /// Decodes `file` at `pixels` (or the art's own size, whichever is smaller); nil when it cannot.
    static func load(_ manifest: HdManifest, _ file: String, pixels: Int) -> HdClip? {
        if let hit = cached(manifest, file, pixels: pixels) { return hit }
        guard let url = url(manifest, file), let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
            markFailed(manifest, file)
            return nil
        }
        let count = CGImageSourceGetCount(source)
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: min(pixels, manifest.px),
            kCGImageSourceShouldCacheImmediately: true,
        ]
        var frames: [CGImage] = []
        var delays: [Double] = []
        for i in 0..<count {
            guard let image = CGImageSourceCreateThumbnailAtIndex(source, i, options as CFDictionary) else { continue }
            frames.append(image)
            let props = CGImageSourceCopyPropertiesAtIndex(source, i, nil) as? [CFString: Any]
            let webp = props?[kCGImagePropertyWebPDictionary] as? [CFString: Any]
            let delay = (webp?[kCGImagePropertyWebPUnclampedDelayTime] as? Double) ?? (webp?[kCGImagePropertyWebPDelayTime] as? Double) ?? 0.1
            delays.append(max(0.02, delay))
        }
        guard !frames.isEmpty else {
            markFailed(manifest, file)
            return nil
        }
        let props = CGImageSourceCopyProperties(source, nil) as? [CFString: Any]
        let loops = ((props?[kCGImagePropertyWebPDictionary] as? [CFString: Any])?[kCGImagePropertyWebPLoopCount] as? Int) ?? 0
        let clip = HdClip(frames: frames, delays: delays, loops: loops)
        cache.setObject(clip, forKey: key(manifest, file, pixels) as NSString)
        return clip
    }

    private static func markFailed(_ manifest: HdManifest, _ file: String) {
        lock.lock()
        failed.insert("\(manifest.folder)/\(file)")
        lock.unlock()
    }
}

/// A character's HD art when it has some and HD mascots are on (and `hd` is
/// not turned off by the caller, as the skin pickers do), else its vector
/// drawing exactly as before (`HdOrVector`).
struct HdOrVector<Vector: View>: View {
    let character: MascotCharacter
    var hd = true
    let key: HdKey
    let size: CGFloat
    var animated = false
    @ViewBuilder let vector: () -> Vector
    /// Settings > Appearance > Mascots > HD mascots (on by default), published by ThemeRoot.
    @Environment(\.hdMascotsEnabled) private var hdEnabled

    var body: some View {
        if hd, hdEnabled, let manifest = HdMascots.manifest(for: character) {
            HdMascotView(manifest: manifest, key: key, size: size, animated: animated, fallback: vector)
        } else {
            vector()
        }
    }
}

struct HdMascotView<Fallback: View>: View {
    let manifest: HdManifest
    let key: HdKey
    let size: CGFloat
    var animated = false
    @ViewBuilder let fallback: () -> Fallback

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.displayScale) private var displayScale
    /// The art on screen: the last that decoded (kept while the next one loads).
    @State private var shown: HdClip?
    @State private var shownFile: String?
    @State private var started = Date()
    @State private var breathing = false
    /// Bumped when a file fails, so the box tries the next fallback.
    @State private var failures = 0

    private var moving: Bool { animated && !reduceMotion }
    private var asset: HdAsset? { HdMascots.asset(manifest, key, moving: moving, size: Double(size)) }
    /// Under 48 pt: head and shoulders, as the vector bust.
    private var bust: Bool { Double(size) < HdMascotData.loopMinSize }
    private var pixels: Int { Int((size * displayScale * (bust ? 1.7 : 1)).rounded(.up)) }

    /// What the box should draw: the asset, its still when the loop failed, or nil (the vector drawing).
    private var target: String? {
        guard let asset else { return nil }
        if !HdArt.hasFailed(manifest, asset.file) { return asset.file }
        if asset.still != asset.file, !HdArt.hasFailed(manifest, asset.still) { return asset.still }
        return nil
    }

    var body: some View {
        ZStack {
            if let shown {
                art(shown)
            } else {
                fallback()
            }
        }
        .frame(width: size, height: size)
        .task(id: "\(target ?? "-")@\(pixels)#\(failures)") { await load() }
    }

    @ViewBuilder private func art(_ clip: HdClip) -> some View {
        let playing = moving && clip.frames.count > 1 && scenePhase == .active
        Group {
            if playing {
                TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: scenePhase != .active)) { timeline in
                    image(clip.frame(at: timeline.date.timeIntervalSince(started)))
                }
            } else {
                image(clip.frames[0])
                    // a still breathes a little where a loop could play (a large mascot)
                    .scaleEffect(x: breathing ? 1.012 : 1, y: breathing ? 0.988 : 1, anchor: UnitPoint(x: 0.5, y: 0.92))
                    .onAppear {
                        guard moving, !bust, clip.frames.count == 1 else { return }
                        withAnimation(.easeInOut(duration: 1.6).repeatForever(autoreverses: true)) { breathing = true }
                    }
            }
        }
    }

    private func image(_ frame: CGImage) -> some View {
        Image(decorative: frame, scale: displayScale)
            .resizable()
            .interpolation(.high)
            .aspectRatio(contentMode: .fit)
            .frame(width: size, height: size)
            .scaleEffect(bust ? 1.7 : 1, anchor: UnitPoint(x: 0.5, y: 0.24))
            .frame(width: size, height: size)
            .clipShape(bust ? AnyShape(Circle()) : AnyShape(Rectangle().inset(by: -size)))
    }

    private func load() async {
        guard let file = target else {
            shown = nil
            shownFile = nil
            return
        }
        if file == shownFile, shown != nil { return }
        let manifest = manifest, pixels = pixels
        if let hit = HdArt.cached(manifest, file, pixels: pixels) {
            show(hit, file)
            return
        }
        let clip = await Task.detached(priority: .utility) { HdArt.load(manifest, file, pixels: pixels) }.value
        if let clip {
            show(clip, file)
        } else {
            // the loop failed: its still next; a still that failed: the vector drawing
            if shownFile == file {
                shown = nil
                shownFile = nil
            }
            failures += 1
        }
    }

    private func show(_ clip: HdClip, _ file: String) {
        if file != shownFile { started = Date() }
        shown = clip
        shownFile = file
    }
}

private struct HdMascotsEnabledKey: EnvironmentKey {
    static let defaultValue = true
}

extension EnvironmentValues {
    /// Settings > Appearance > Mascots > HD mascots (on by default).
    var hdMascotsEnabled: Bool {
        get { self[HdMascotsEnabledKey.self] }
        set { self[HdMascotsEnabledKey.self] = newValue }
    }
}
