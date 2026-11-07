import XCTest
@testable import CompanionCore

final class VideoPlayerPolicyTests: XCTestCase {
    private func decode(_ json: String) throws -> WireVideoWidget {
        try JSONDecoder().decode(WireVideoWidget.self, from: Data(json.utf8))
    }

    func testDecodesTheOptionalPlayerDetailsAndStaysBackwardCompatible() throws {
        let plain = try decode(#"{"kind":"vod","playbackUrl":"/api/media/proxy/a"}"#)
        XCTAssertNil(plain.chapters)
        XCTAssertNil(plain.expiresAt)

        let rich = try decode("""
        {"kind":"live","playbackUrl":"/api/media/proxy/b","format":"hls","id":"7","avatarUrl":"/api/media/proxy/c",
         "category":"Strategy","startedAt":"2026-11-06T12:00:00Z","tags":["English"],"recording":true,
         "chapters":[{"startMs":0,"title":"Intro"},{"startMs":60000,"title":"Draft"}],
         "channelUrl":"https://example.com/c","expiresAt":1800000000000,"viewerCount":12,"future":"ignored"}
        """)
        XCTAssertEqual(rich.category, "Strategy")
        XCTAssertEqual(rich.tags, ["English"])
        XCTAssertEqual(rich.recording, true)
        XCTAssertEqual(rich.chapters?.last, VideoChapter(startMs: 60_000, title: "Draft"))
        XCTAssertEqual(rich.expiresAt, 1_800_000_000_000)
    }

    func testLiveLatencyAndBackoff() {
        XCTAssertFalse(VideoPlayerPolicy.isBehindLive(current: 590, edge: 597))
        XCTAssertTrue(VideoPlayerPolicy.isBehindLive(current: 500, edge: 597))
        XCTAssertFalse(VideoPlayerPolicy.isBehindLive(current: 500, edge: nil))
        XCTAssertTrue(VideoPlayerPolicy.hasDvr(start: 0, end: 600))
        XCTAssertFalse(VideoPlayerPolicy.hasDvr(start: 590, end: 600))
        XCTAssertEqual((0...4).map { VideoPlayerPolicy.reloadBackoff(attempt: $0) }, [1, 2, 4, 8, 8])
    }

    func testExpiry() {
        XCTAssertEqual([401, 403, 410, 404, 500].map { VideoPlayerPolicy.isExpiredStatus($0) }, [true, true, true, false, false])
        let now = Date(timeIntervalSince1970: 2)
        XCTAssertTrue(VideoPlayerPolicy.isExpired(expiresAt: 1_000, now: now))
        XCTAssertFalse(VideoPlayerPolicy.isExpired(expiresAt: 3_000, now: now))
        XCTAssertFalse(VideoPlayerPolicy.isExpired(expiresAt: nil, now: now))
    }

    func testResumeKeyAndThresholds() throws {
        XCTAssertEqual(VideoPlayerPolicy.resumeKey(try decode(#"{"kind":"vod","playbackUrl":"/p","id":"7"}"#)), "id:7")
        XCTAssertEqual(VideoPlayerPolicy.resumeKey(try decode(#"{"kind":"vod","playbackUrl":"/p","title":"T","streamer":"S"}"#)), "meta:S|T")
        XCTAssertEqual(VideoPlayerPolicy.resumeKey(try decode(#"{"kind":"vod","playbackUrl":"/p"}"#)), "url:/p")

        let defaults = try XCTUnwrap(UserDefaults(suiteName: "VideoPlayerPolicyTests"))
        defaults.removePersistentDomain(forName: "VideoPlayerPolicyTests")
        defer { defaults.removePersistentDomain(forName: "VideoPlayerPolicyTests") }
        VideoPlayerPolicy.saveResumePosition(key: "a", at: 5, duration: 100, defaults: defaults)
        XCTAssertNil(VideoPlayerPolicy.loadResumePosition(key: "a", defaults: defaults))
        VideoPlayerPolicy.saveResumePosition(key: "a", at: 42.7, duration: 100, defaults: defaults)
        XCTAssertEqual(VideoPlayerPolicy.loadResumePosition(key: "a", defaults: defaults), 42)
        VideoPlayerPolicy.saveResumePosition(key: "a", at: 96, duration: 100, defaults: defaults)
        XCTAssertNil(VideoPlayerPolicy.loadResumePosition(key: "a", defaults: defaults))
        for i in 0..<205 {
            VideoPlayerPolicy.saveResumePosition(key: "k\(i)", at: 20, duration: 100, defaults: defaults, now: Date(timeIntervalSince1970: Double(i)))
        }
        XCTAssertNil(VideoPlayerPolicy.loadResumePosition(key: "k0", defaults: defaults))
        XCTAssertEqual(VideoPlayerPolicy.loadResumePosition(key: "k204", defaults: defaults), 20)
    }

    func testUptimeClockAndChapters() {
        let now = Date(timeIntervalSince1970: 1_793_000_000)
        let started = ISO8601DateFormatter().string(from: now.addingTimeInterval(-3_723))
        XCTAssertEqual(VideoPlayerPolicy.uptime(startedAt: started, now: now), 3_723)
        XCTAssertNil(VideoPlayerPolicy.uptime(startedAt: ISO8601DateFormatter().string(from: now.addingTimeInterval(60)), now: now))
        XCTAssertEqual(VideoPlayerPolicy.clock(3_723), "1:02:03")
        XCTAssertEqual(VideoPlayerPolicy.clock(245), "4:05")
        let chapters = [VideoChapter(startMs: 0, title: "A"), VideoChapter(startMs: 60_000, title: "B")]
        XCTAssertEqual(VideoPlayerPolicy.chapter(at: 30, in: chapters)?.title, "A")
        XCTAssertEqual(VideoPlayerPolicy.chapter(at: 61, in: chapters)?.title, "B")
        XCTAssertNil(VideoPlayerPolicy.chapter(at: 61, in: nil))
    }
}
