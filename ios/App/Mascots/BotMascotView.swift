// Every bot avatar in the app: the desktop's `BotAvatar` (`Avatar.tsx`).
//
// A bot with an uploaded or generated picture and a crop other than `mascot`
// shows that picture, masked to its crop and framed by its zoom and focus.
// Everything else, and every picture that is missing, still loading or will
// not decode, draws the bot's character from its stored look, so identity is
// never an empty placeholder.
import CompanionCore
import SwiftUI
import UIKit

struct BotMascotView: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    let size: CGFloat
    var state: MausState = .idle
    /// Opt-in: an animated mascot ticks at 30 fps.
    var animated = false
    /// Sidebar row: a short squish on tap (no hover on iOS).
    var sidebarTapReact = false
    /// Comets orbiting the mascot: the island's "something is happening".
    var comets = false
    /// Wing moves and beats for the owl (profile preview).
    var owlHandle: OwlMascotHandle?

    @EnvironmentObject private var session: Session
    @State private var image: UIImage?
    @State private var failed = false
    @State private var tapSquish = false

    private var crop: AvatarCrop { bot.avatarCrop ?? .mascot }
    private var outcome: BotAvatarOutcome {
        resolveBotAvatarOutcome(crop: crop, hasUrl: bot.avatarUrl != nil, imageDecoded: image != nil, failed: failed)
    }

    var body: some View {
        Group {
            switch outcome {
            case .flatImage: picture
            case .gradientMascot:
                MascotComets(size: size, active: comets) {
                    MascotCharacterView(bot: bot, size: size, state: state, animated: animated, owlHandle: owlHandle)
                }
            }
        }
        .frame(width: size, height: size)
        .scaleEffect(tapSquish ? CGSize(width: 1.1, height: 0.86) : CGSize(width: 1, height: 1))
        .animation(.spring(response: 0.32, dampingFraction: 0.62), value: tapSquish)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(bot.name) avatar")
        .simultaneousGesture(
            sidebarTapReact
                ? TapGesture().onEnded {
                    guard !UIAccessibility.isReduceMotionEnabled else { return }
                    tapSquish = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.34) { tapSquish = false }
                }
                : nil
        )
        .task(id: "\(bot.avatarUrl ?? "")|\(crop.rawValue)") {
            image = nil
            failed = false
            // only the flat crops paint the bytes; the character never needs them
            guard crop != .mascot, bot.avatarUrl != nil else { return }
            let data = await session.avatarData(for: bot)
            guard !Task.isCancelled else { return }
            // every frame of an animated avatar is decoded at once: not on the main thread
            let decoded = await Task.detached(priority: .userInitiated) { data.flatMap(Self.decode) }.value
            guard !Task.isCancelled else { return }
            guard let decoded else {
                failed = true
                return
            }
            guard !Task.isCancelled else { return }
            image = decoded
        }
    }

    @ViewBuilder private var picture: some View {
        if let image {
            let framing = bot.framing
            FramedPicture(image: image, size: size, crop: crop, zoom: framing.zoom, focusX: framing.focusX, focusY: framing.focusY)
        }
    }

    /// An animated GIF or WebP becomes an animated `UIImage`; everything else a still.
    nonisolated private static func decode(_ data: Data) -> UIImage? {
        if let animation = AnimatedImageDecoder.decode(data) {
            let frames = animation.frames.map { UIImage(cgImage: $0) }
            if let animated = UIImage.animatedImage(with: frames, duration: animation.duration) {
                return animated
            }
        }
        return UIImage(data: data)
    }
}

/// A picture in its crop: `object-fit: cover` at the focus point, then
/// scaled by the zoom about that same point (`AvatarFraming.imageRect`),
/// masked to a circle, 22 % corners or a square.
struct FramedPicture: View {
    @Environment(\.themePalette) var themePalette
    let image: UIImage
    let size: CGFloat
    let crop: AvatarCrop
    var zoom: Double = 1
    var focusX: Double = 0.5
    var focusY: Double = 0.5

    var body: some View {
        let rect = AvatarFraming.imageRect(imageSize: image.size, box: size, zoom: zoom, focusX: focusX, focusY: focusY)
        ZStack(alignment: .topLeading) {
            Theme.parity(Color(uiColor: .secondarySystemBackground), Theme.card)
            Group {
                // SwiftUI's `Image` draws only a still; an animated attachment plays in UIKit
                if image.images == nil {
                    Image(uiImage: image).resizable()
                } else {
                    AnimatedAttachmentView(image: image)
                }
            }
            .frame(width: rect.width, height: rect.height)
            .offset(x: rect.minX, y: rect.minY)
        }
        .frame(width: size, height: size, alignment: .topLeading)
        .clipShape(RoundedRectangle(cornerRadius: AvatarFraming.cornerRadius(crop, box: size), style: .circular))
    }
}

/// `UIImageView` plays an animated `UIImage` on its own. Sizing is left to the
/// SwiftUI frame around it.
private struct AnimatedAttachmentView: UIViewRepresentable {
    let image: UIImage

    func makeUIView(context: Context) -> UIImageView {
        let view = UIImageView(image: image)
        view.contentMode = .scaleToFill
        view.clipsToBounds = true
        view.isAccessibilityElement = false
        for axis in [NSLayoutConstraint.Axis.horizontal, .vertical] {
            view.setContentHuggingPriority(.defaultLow, for: axis)
            view.setContentCompressionResistancePriority(.defaultLow, for: axis)
        }
        view.startAnimating()
        return view
    }

    func updateUIView(_ view: UIImageView, context: Context) {
        guard view.image !== image else { return }
        view.image = image
        view.startAnimating()
    }
}

/// A chat's avatar: a bot's own, or a room's members as a group.
struct ChatAvatarView: View {
    @Environment(\.themePalette) var themePalette
    let chat: Chat
    let size: CGFloat
    var state: MausState = .idle
    var animated = false
    var comets = false
    /// The surface a room's cut-outs are painted in.
    var background: Color = Theme.parity(Color(uiColor: .systemBackground), Theme.bg)

    @EnvironmentObject private var session: Session

    var body: some View {
        switch chat {
        case let .bot(bot):
            BotMascotView(bot: bot, size: size, state: state, animated: animated, comets: comets)
        case let .room(room):
            MascotComets(size: size, active: comets) {
                // WP15 (RM22): a conversation with a person shows them
                if let peer = PeopleDirectory.shared.peer(room, session: session) {
                    PersonAvatar(initials: peer.initials, size: size, presenceId: peer.id,
                                 avatarUrl: PeopleDirectory.shared.directory?.person(peer.id)?.avatarUrl)
                } else {
                    GroupMascotView(members: room.memberIds.compactMap { session.state.bot($0) }, size: size, background: background)
                }
            }
        }
    }
}
