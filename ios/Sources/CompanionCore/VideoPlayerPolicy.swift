// The chat video player's rules, shared with the web player
// (src/components/video/video-player-state.ts): live latency and "back to
// live", stall recovery backoff, expired share links, VOD resume position,
// uptime and chapters. Pure, so the decoding and policy tests pin them.
import Foundation

public enum VideoPlayerPolicy {
    /// Seconds behind the live edge before the card offers "Back to live".
    public static let behindLiveSeconds: Double = 12
    /// A seekable live window shorter than this is not a DVR.
    public static let minDvrWindowSeconds: Double = 30
    /// Stall recovery: 1, 2, 4, 8 s (cap), at most 6 reloads.
    public static let reloadBackoffCapSeconds: Double = 8
    public static let reloadMaxAttempts = 6
    /// Resume position: kept from 10 s, cleared after 95 %, 200 entries at most.
    public static let resumeMinSeconds: Double = 10
    public static let resumeDoneRatio: Double = 0.95
    public static let resumeMaxEntries = 200
    public static let resumeStoreKey = "sagax.video.resume.v1"

    public static func reloadBackoff(attempt: Int) -> Double {
        min(reloadBackoffCapSeconds, pow(2, Double(max(0, attempt))))
    }

    public static func hasDvr(start: Double, end: Double) -> Bool {
        end.isFinite && start.isFinite && end - start >= minDvrWindowSeconds
    }

    /// Seconds the playhead is behind the live edge (0 at the edge).
    public static func liveLatency(current: Double, edge: Double?) -> Double {
        guard let edge, edge.isFinite, current.isFinite else { return 0 }
        return max(0, edge - current)
    }

    public static func isBehindLive(current: Double, edge: Double?) -> Bool {
        liveLatency(current: current, edge: edge) > behindLiveSeconds
    }

    /// 401/403 from the media server or Sagax's proxy, 410 gone: the share
    /// link (or the proxy token for it) is no longer valid.
    public static func isExpiredStatus(_ status: Int?) -> Bool {
        status == 401 || status == 403 || status == 410
    }

    /// `expiresAt` is epoch milliseconds, as on the wire.
    public static func isExpired(expiresAt: Double?, now: Date = Date()) -> Bool {
        guard let expiresAt, expiresAt.isFinite else { return false }
        return now.timeIntervalSince1970 * 1000 >= expiresAt
    }

    /// The key a VOD resume position is stored under: the emitter's id, else
    /// what the card shows; the proxied URL changes on every mint, so it is
    /// the key only when nothing else names the video.
    public static func resumeKey(_ video: WireVideoWidget) -> String {
        if let id = video.id, !id.isEmpty { return "id:\(id)" }
        var parts: [String] = []
        for part in [video.source, video.streamer, video.title] {
            if let part, !part.isEmpty { parts.append(part) }
        }
        if let duration = video.durationMs { parts.append(duration.rounded() == duration ? String(Int(duration)) : String(duration)) }
        return parts.isEmpty ? "url:\(video.playbackUrl)" : "meta:\(parts.joined(separator: "|"))"
    }

    private struct ResumeEntry: Codable { var at: Double; var t: Double }

    private static func readResume(_ defaults: UserDefaults) -> [String: ResumeEntry] {
        guard let data = defaults.data(forKey: resumeStoreKey),
              let map = try? JSONDecoder().decode([String: ResumeEntry].self, from: data) else { return [:] }
        return map
    }

    private static func writeResume(_ map: [String: ResumeEntry], _ defaults: UserDefaults) {
        if let data = try? JSONEncoder().encode(map) { defaults.set(data, forKey: resumeStoreKey) }
    }

    public static func loadResumePosition(key: String, defaults: UserDefaults = .standard) -> Double? {
        guard let entry = readResume(defaults)[key], entry.at.isFinite, entry.at >= resumeMinSeconds else { return nil }
        return entry.at
    }

    public static func saveResumePosition(
        key: String, at: Double, duration: Double,
        defaults: UserDefaults = .standard, now: Date = Date()
    ) {
        var map = readResume(defaults)
        let done = duration > 0 && at / duration >= resumeDoneRatio
        if !at.isFinite || at < resumeMinSeconds || done {
            guard map[key] != nil else { return }
            map[key] = nil
            writeResume(map, defaults)
            return
        }
        map[key] = ResumeEntry(at: at.rounded(.down), t: now.timeIntervalSince1970 * 1000)
        if map.count > resumeMaxEntries {
            let oldest = map.sorted { $0.value.t < $1.value.t }.prefix(map.count - resumeMaxEntries)
            for (old, _) in oldest { map[old] = nil }
        }
        writeResume(map, defaults)
    }

    /// Elapsed time since a stream started, or nil (no start, or in the future).
    public static func uptime(startedAt: String?, now: Date = Date()) -> TimeInterval? {
        guard let startedAt, let start = parseDate(startedAt), start <= now else { return nil }
        return now.timeIntervalSince(start)
    }

    /// "1:02:03" or "4:05".
    public static func clock(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds))
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }

    /// The chapter that holds a position (seconds), or nil.
    public static func chapter(at seconds: Double, in chapters: [VideoChapter]?) -> VideoChapter? {
        guard let chapters, !chapters.isEmpty else { return nil }
        var found: VideoChapter?
        for chapter in chapters {
            if chapter.startMs / 1000 <= seconds { found = chapter } else { break }
        }
        return found
    }

    static func parseDate(_ text: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: text) { return date }
        return ISO8601DateFormatter().date(from: text)
    }
}
