// Inline HLS or MP4 video in the transcript, the native peer of the web
// player (src/components/video/VideoPlayerWidget.tsx): AVPlayerViewController
// for the controls, fullscreen, Picture in Picture and AirPlay; a live DVR
// window with "Back to live"; stall recovery with backoff; VOD resume; chapter
// chips; an expired share link asks the bot for a new one.
import AVKit
import Combine
import SwiftUI
import CompanionCore

struct VideoWidgetView: View {
    @EnvironmentObject private var session: Session
    let video: WireVideoWidget
    /// Sends a message to the bot of this chat (a new link for an expired one).
    var onRequestRefresh: ((String) -> Void)?
    @StateObject private var model = VideoPlayerModel()

    private var title: String {
        video.title ?? video.streamer ?? String(localized: "Untitled video")
    }

    var body: some View {
        VideoWidgetChrome(
            title: title,
            streamer: video.streamer,
            source: video.source,
            live: video.kind == "live",
            viewerCount: video.viewerCount,
            loading: model.loading && model.player != nil,
            error: model.expired ? String(localized: "This video link has expired.") : model.error,
            onRetry: { model.load(video: video, url: playbackURL) },
            avatarURL: video.avatarUrl.flatMap { session.absoluteAPIURL(path: $0) },
            category: video.category,
            tags: video.tags ?? [],
            recording: video.recording == true,
            startedAt: video.startedAt,
            expired: model.expired,
            refreshRequested: model.refreshRequested,
            onRequestNewLink: onRequestRefresh.map { send -> () -> Void in
                {
                    guard !model.refreshRequested else { return }
                    model.refreshRequested = true
                    send(String(format: String(localized: "The video link for “%@” expired. Send me a new one."), title))
                }
            },
            behindLive: model.behindLive,
            onGoLive: { model.goLive() },
            footer: chaptersRow,
            stage: {
                Group {
                    if let player = model.player {
                        NativePlayerView(player: player)
                    } else {
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .fill(Color.black)
                    }
                }
            },
            drawer: { EmptyView() }
        )
        .onAppear { model.load(video: video, url: playbackURL) }
        .onDisappear { model.teardown() }
    }

    private var playbackURL: URL? { session.absoluteAPIURL(path: video.playbackUrl) }

    /// Chapter chips under the stage; the current one is filled, a tap seeks.
    private var chaptersRow: AnyView? {
        guard video.kind != "live", let chapters = video.chapters, !chapters.isEmpty else { return nil }
        let current = VideoPlayerPolicy.chapter(at: model.position, in: chapters)
        return AnyView(
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(chapters, id: \.self) { chapter in
                        Button {
                            model.seek(to: chapter.startMs / 1000)
                        } label: {
                            HStack(spacing: 4) {
                                Text(verbatim: VideoPlayerPolicy.clock(chapter.startMs / 1000))
                                    .font(.system(size: 11, weight: .semibold).monospacedDigit())
                                    .foregroundStyle(.secondary)
                                Text(chapter.title)
                                    .font(.system(size: 12, weight: .medium))
                                    .lineLimit(1)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Capsule().fill(chapter == current ? Color.accentColor.opacity(0.22) : Color.secondary.opacity(0.12)))
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(chapter == current ? .isSelected : [])
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            .accessibilityIdentifier("video-chapters")
        )
    }
}

/// AVPlayerViewController: native transport controls, skip, fullscreen,
/// Picture in Picture (inline start when the app goes to the background),
/// AirPlay and Now Playing.
private struct NativePlayerView: UIViewControllerRepresentable {
    let player: AVPlayer

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.allowsPictureInPicturePlayback = true
        controller.canStartPictureInPictureAutomaticallyFromInline = true
        controller.updatesNowPlayingInfoCenter = true
        controller.entersFullScreenWhenPlaybackBegins = false
        controller.exitsFullScreenWhenPlaybackEnds = true
        controller.videoGravity = .resizeAspect
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if controller.player !== player { controller.player = player }
    }
}

@MainActor
final class VideoPlayerModel: ObservableObject {
    @Published private(set) var player: AVPlayer?
    @Published private(set) var loading = true
    @Published private(set) var error: String?
    @Published private(set) var expired = false
    @Published var refreshRequested = false
    @Published private(set) var behindLive = false
    @Published private(set) var position: Double = 0

    private var video: WireVideoWidget?
    private var url: URL?
    private var attempts = 0
    private var resumed = false
    private var timeObserver: Any?
    private var observers: [AnyCancellable] = []
    private var retryTask: Task<Void, Never>?

    private var isLive: Bool { video?.kind == "live" }

    func load(video: WireVideoWidget, url: URL?) {
        self.video = video
        self.url = url
        attempts = 0
        start()
    }

    private func start() {
        teardown()
        loading = true
        error = nil
        guard let video, let url else {
            fail(String(localized: "Could not play this video."))
            return
        }
        if VideoPlayerPolicy.isExpired(expiresAt: video.expiresAt) {
            expired = true
            loading = false
            return
        }
        expired = false
        // AVPlayer fetches the playlist and its segments itself and sends no
        // bearer. A proxied URL (/api/media/proxy/<token>) needs none: the
        // server takes its signed, thread-bound, short-lived token as the
        // authorization (server/routes/media-widgets.ts).
        let item = AVPlayerItem(url: url)
        let p = AVPlayer(playerItem: item)
        p.allowsExternalPlayback = true
        observe(p, item: item)
        player = p
    }

    private func observe(_ p: AVPlayer, item: AVPlayerItem) {
        item.publisher(for: \.status)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] status in
                guard let self else { return }
                switch status {
                case .readyToPlay:
                    self.loading = false
                    self.attempts = 0
                    self.resumeIfNeeded(p)
                case .failed:
                    self.handleFailure()
                default:
                    break
                }
            }
            .store(in: &observers)
        NotificationCenter.default.publisher(for: AVPlayerItem.playbackStalledNotification, object: item)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.scheduleReload() }
            .store(in: &observers)
        timeObserver = p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 1, preferredTimescale: 600), queue: .main) { [weak self] time in
            MainActor.assumeIsolated { self?.tick(time.seconds) }
        }
    }

    private func tick(_ seconds: Double) {
        guard let player, let item = player.currentItem, seconds.isFinite else { return }
        position = seconds
        if isLive {
            let edge = item.seekableTimeRanges.last.map { CMTimeRangeGetEnd($0.timeRangeValue).seconds }
            let start = item.seekableTimeRanges.last.map { $0.timeRangeValue.start.seconds } ?? 0
            behindLive = edge.map { VideoPlayerPolicy.hasDvr(start: start, end: $0) } == true
                && VideoPlayerPolicy.isBehindLive(current: seconds, edge: edge)
        } else if let video, player.rate != 0 {
            let duration = item.duration.seconds
            VideoPlayerPolicy.saveResumePosition(
                key: VideoPlayerPolicy.resumeKey(video), at: seconds,
                duration: duration.isFinite ? duration : (video.durationMs ?? 0) / 1000
            )
        }
    }

    private func resumeIfNeeded(_ p: AVPlayer) {
        guard !resumed, !isLive, let video else { return }
        resumed = true
        if let at = VideoPlayerPolicy.loadResumePosition(key: VideoPlayerPolicy.resumeKey(video)) {
            p.seek(to: CMTime(seconds: at, preferredTimescale: 600))
        }
    }

    /// A failed item: an expired link (401/403/410 on a probe) or a reload
    /// with backoff, then the error panel.
    private func handleFailure() {
        guard let url else { return }
        Task { [weak self] in
            var request = URLRequest(url: url)
            request.setValue("bytes=0-0", forHTTPHeaderField: "Range")
            let status = (try? await URLSession.shared.data(for: request))
                .flatMap { ($0.1 as? HTTPURLResponse)?.statusCode }
            guard let self else { return }
            if VideoPlayerPolicy.isExpiredStatus(status) {
                self.teardown()
                self.expired = true
                self.loading = false
            } else {
                self.scheduleReload()
            }
        }
    }

    private func scheduleReload() {
        guard retryTask == nil else { return }
        guard attempts < VideoPlayerPolicy.reloadMaxAttempts else {
            fail(String(localized: "Could not play this video."))
            return
        }
        let delay = VideoPlayerPolicy.reloadBackoff(attempt: attempts)
        attempts += 1
        loading = true
        retryTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard let self, !Task.isCancelled else { return }
            self.retryTask = nil
            let tries = self.attempts
            let wasPlaying = (self.player?.rate ?? 0) != 0 || self.isLive
            let at = self.player?.currentTime()
            self.start()
            self.attempts = tries
            if let at, !self.isLive { self.player?.seek(to: at, completionHandler: { _ in }) }
            if wasPlaying { self.player?.play() }
        }
    }

    private func fail(_ message: String) {
        teardown()
        error = message
        loading = false
    }

    func goLive() {
        guard let item = player?.currentItem, let range = item.seekableTimeRanges.last?.timeRangeValue else { return }
        player?.seek(to: CMTimeRangeGetEnd(range)) { [weak self] _ in
            Task { @MainActor in self?.behindLive = false }
        }
        player?.play()
    }

    func seek(to seconds: Double) {
        player?.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
        position = seconds
    }

    func teardown() {
        retryTask?.cancel()
        retryTask = nil
        observers.removeAll()
        if let timeObserver, let player { player.removeTimeObserver(timeObserver) }
        timeObserver = nil
        player?.pause()
        player = nil
        behindLive = false
    }
}
