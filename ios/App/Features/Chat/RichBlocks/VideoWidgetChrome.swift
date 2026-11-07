// Premium inline video card chrome (live/VOD and YouTube).
import SwiftUI
import CompanionCore

struct VideoWidgetChrome<Stage: View, Drawer: View>: View {
    @Environment(\.themePalette) var themePalette
    let title: String
    var streamer: String?
    var source: String?
    var live: Bool = false
    var viewerCount: Int?
    var loading: Bool = false
    var error: String?
    var onRetry: (() -> Void)?
    /// Player details (shared/video-widget.ts): avatar, category, tags, REC,
    /// and the live start the uptime counts from.
    var avatarURL: URL?
    var category: String?
    var tags: [String] = []
    var recording: Bool = false
    var startedAt: String?
    /// The share link no longer plays: the error panel offers a new link.
    var expired: Bool = false
    var refreshRequested: Bool = false
    var onRequestNewLink: (() -> Void)?
    /// Behind the live edge of a DVR window: "Back to live" in the pill row.
    var behindLive: Bool = false
    var onGoLive: (() -> Void)?
    var drawerOpen: Bool = false
    /// False for a player that draws its own title and controls (the YouTube
    /// embed): nothing is laid over the stage, so its play button, scrub bar
    /// and fullscreen button stay visible and tappable.
    var overlaysStage: Bool = true
    /// A row under the stage (title and actions when `overlaysStage` is false).
    var footer: AnyView?
    @ViewBuilder var stage: () -> Stage
    @ViewBuilder var drawer: () -> Drawer

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .topLeading) {
                stage()
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                if overlaysStage {
                    LinearGradient(
                        colors: [.black.opacity(0.72), .black.opacity(0.05), .clear],
                        startPoint: .top,
                        endPoint: .center
                    )
                    .allowsHitTesting(false)
                    HStack(alignment: .top, spacing: 8) {
                        if let avatarURL {
                            AsyncImage(url: avatarURL) { image in
                                image.resizable().scaledToFill()
                            } placeholder: {
                                Circle().fill(.white.opacity(0.2))
                            }
                            .frame(width: 32, height: 32)
                            .clipShape(Circle())
                            .accessibilityHidden(true)
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text(title)
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(.white)
                                .lineLimit(2)
                            let byline = [streamer, category, source].compactMap { $0 }.filter { !$0.isEmpty }
                            if !byline.isEmpty {
                                Text(byline.joined(separator: " · "))
                                    .font(.system(size: 12))
                                    .foregroundStyle(.white.opacity(0.78))
                                    .lineLimit(1)
                            }
                            if !tags.isEmpty {
                                HStack(spacing: 4) {
                                    ForEach(tags.prefix(4), id: \.self) { tag in
                                        Text(tag)
                                            .font(.system(size: 10.5, weight: .semibold))
                                            .foregroundStyle(.white)
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(Capsule().fill(.white.opacity(0.18)))
                                    }
                                }
                                .accessibilityIdentifier("video-tags")
                            }
                        }
                    }
                    .padding(12)
                    .allowsHitTesting(false)
                }
                if live || recording {
                    VStack(alignment: .trailing, spacing: 6) {
                        if live { livePill }
                        HStack(spacing: 6) {
                            if recording {
                                HStack(spacing: 4) {
                                    Circle().fill(Color.red).frame(width: 6, height: 6)
                                    Text(verbatim: "REC").font(.system(size: 10.5, weight: .bold))
                                }
                                .accessibilityElement(children: .ignore)
                                .accessibilityLabel(Text("Recording"))
                                .accessibilityIdentifier("video-rec")
                            }
                            if live, startedAt != nil {
                                TimelineView(.periodic(from: .now, by: 1)) { context in
                                    if let up = VideoPlayerPolicy.uptime(startedAt: startedAt, now: context.date) {
                                        Text(verbatim: VideoPlayerPolicy.clock(up))
                                            .font(.system(size: 10.5, weight: .semibold).monospacedDigit())
                                            .accessibilityLabel(Text("Live for") + Text(verbatim: " \(VideoPlayerPolicy.clock(up))"))
                                            .accessibilityIdentifier("video-uptime")
                                    }
                                }
                            }
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(.black.opacity(0.45)))
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                }
                if loading {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Theme.card.opacity(0.35))
                        .aspectRatio(16 / 9, contentMode: .fit)
                        .overlay { ProgressView().tint(.white) }
                }
                if let error {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(.black.opacity(0.55))
                        .aspectRatio(16 / 9, contentMode: .fit)
                        .overlay {
                            VStack(spacing: 10) {
                                if expired {
                                    Image(systemName: "clock.badge.exclamationmark")
                                        .font(.system(size: 22))
                                        .foregroundStyle(.white)
                                        .accessibilityHidden(true)
                                }
                                Text(error)
                                    .font(.system(size: 14))
                                    .multilineTextAlignment(.center)
                                    .foregroundStyle(.white)
                                HStack(spacing: 8) {
                                    if expired, let onRequestNewLink {
                                        Button(action: onRequestNewLink) {
                                            Label(
                                                refreshRequested ? String(localized: "New link requested") : String(localized: "Get a new link"),
                                                systemImage: "arrow.clockwise"
                                            )
                                        }
                                        .buttonStyle(.borderedProminent)
                                        .disabled(refreshRequested)
                                        .accessibilityIdentifier("video-request-new-link")
                                    }
                                    if let onRetry {
                                        if expired && onRequestNewLink != nil {
                                            Button(String(localized: "Try again"), action: onRetry)
                                                .buttonStyle(.bordered)
                                                .tint(.white)
                                        } else {
                                            Button(String(localized: "Try again"), action: onRetry)
                                                .buttonStyle(.borderedProminent)
                                        }
                                    }
                                }
                            }
                            .padding()
                        }
                }
            }
            .shadow(color: .black.opacity(0.18), radius: 18, y: 8)
            if let footer {
                footer
            }
            if drawerOpen {
                drawer()
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .frame(maxWidth: 520, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Theme.card)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Theme.hairline.opacity(0.35), lineWidth: 1)
        )
    }

    /// LIVE pill (red at the edge, grey behind it) and "Back to live".
    private var livePill: some View {
        HStack(spacing: 6) {
            HStack(spacing: 6) {
                Circle().fill(.white).frame(width: 6, height: 6)
                Text("Live")
                    .font(.system(size: 11, weight: .bold))
                if let viewerCount, viewerCount > 0 {
                    Text(verbatim: "·")
                    Text(String(format: String(localized: "%@ watching"), viewerCount.formatted()))
                        .font(.system(size: 11, weight: .medium))
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(behindLive ? Color.gray.opacity(0.85) : Color.red.opacity(0.92)))
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("video-live-pill")
            if behindLive, let onGoLive {
                Button(action: onGoLive) {
                    Label(String(localized: "Back to live"), systemImage: "dot.radiowaves.left.and.right")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Capsule().fill(Color.red.opacity(0.92)))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("video-go-live")
            }
        }
    }
}

extension VideoWidgetChrome where Drawer == EmptyView {
    init(
        title: String,
        streamer: String? = nil,
        source: String? = nil,
        live: Bool = false,
        viewerCount: Int? = nil,
        loading: Bool = false,
        error: String? = nil,
        onRetry: (() -> Void)? = nil,
        @ViewBuilder stage: @escaping () -> Stage
    ) {
        self.title = title
        self.streamer = streamer
        self.source = source
        self.live = live
        self.viewerCount = viewerCount
        self.loading = loading
        self.error = error
        self.onRetry = onRetry
        self.drawerOpen = false
        self.stage = stage
        self.drawer = { EmptyView() }
    }
}
