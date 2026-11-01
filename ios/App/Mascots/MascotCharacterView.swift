// A bot's character drawn from its stored look: the owl, one of the shapes,
// Trombi, Bunbu, Shiba, Grump, Ogre, Frog or Crab (`CharacterAvatar` and `MausAvatar` in the desktop's
// `Avatar.tsx`). A known character is always drawn as itself; where a skin's
// premium layers are not on the phone yet, its base finish shows and
// `MascotSubstitution` logs it. No picture and no network here, so the widgets and the Live
// Activity can draw it too; `BotMascotView` adds the uploaded picture.
import CompanionCore
import SwiftUI

struct MascotCharacterView: View {
    let look: CompleteMascotLook
    /// A bot colour name; the owl and the shapes wear it, Trombi has none.
    let color: String
    var skin: MascotSkin = .none
    var size: CGFloat = 44
    var state: MausState = .idle
    var animated = false
    /// Wing moves and beats for the owl, the Shapes moves for a shape (profile preview).
    var owlHandle: OwlMascotHandle?
    /// Off keeps the vector look even for a character with HD art (the skin pickers, as on the desktop).
    var hd = true

    var body: some View {
        character
            .modifier(MascotDropShadow())
            .onAppear { MascotSubstitution.report(look, owlSkin: skin) }
    }

    @ViewBuilder private var character: some View {
        switch look.character {
        case .owl:
            OwlMascotView(color: color, skin: skin, size: size, state: state.owlState, animated: animated, handle: owlHandle)
        case .shape:
            ShapeMascotView(shape: look.shape, skin: look.shapeSkin, color: color, size: size, mood: state.shapeMood, avatarDef: look.avatarDef, animated: animated, handle: owlHandle)
        case .trombi:
            TrombiMascotView(skin: look.trombiSkin, size: size, pose: state.trombiPose, animated: animated)
        case .bunbu:
            BunbuMascotView(skin: look.bunbuSkin, color: color, size: size, mood: BunbuMood(state: state), animated: animated)
        case .shiba:
            HdOrVector(character: .shiba, hd: hd, key: HdMascots.key(forState: state.rawValue), size: size, animated: animated) {
                ShibaMascotView(skin: look.shibaSkin, color: color, size: size, expression: ShibaExpression.forState(state.rawValue), animated: animated)
            }
        case .grump:
            GrumpMascotView(skin: look.grumpSkin, color: color, size: size, expression: GrumpFace.expression(for: state), animated: animated)
        case .ogre:
            OgreMascotView(skin: look.ogreSkin, color: color, size: size, expression: OgreArt.expression(for: state.rawValue), animated: animated)
        case .frog:
            FrogMascotView(skin: look.frogSkin, color: color, size: size, expression: FrogExpression.forState(state.rawValue), animated: animated)
        case .crab:
            CrabMascotView(skin: look.crabSkin, color: color, size: size, mood: CrabMood(state: state), animated: animated)
        }
    }
}

extension MascotCharacterView {
    /// The bot's own character, colour and skin.
    init(bot: Bot, size: CGFloat, state: MausState = .idle, animated: Bool = false, owlHandle: OwlMascotHandle? = nil) {
        self.init(look: bot.resolvedMascotLook, color: bot.color, skin: bot.resolvedMascotSkin, size: size, state: state, animated: animated, owlHandle: owlHandle)
    }
}

/// A room's face: its members' own mascots in one frame, the three-member
/// layout of the reference's pinned group (`measure-home.md`): each member at
/// 0.57 of the frame, the back one up top, then bottom-left, then the front
/// one bottom-right, each cut out of those behind it by a background-coloured
/// outline about 0.062 of the frame wide.
struct GroupMascotView: View {
    let members: [Bot]
    var size: CGFloat = 52
    /// The surface the group sits on, which the cut-outs are painted in.
    var background: Color = Color(uiColor: .systemBackground)
    var state: MausState = .happy

    /// Offsets from the frame centre, as fractions of the frame.
    static let three: [CGPoint] = [CGPoint(x: -0.008, y: -0.236), CGPoint(x: -0.241, y: 0.234), CGPoint(x: 0.233, y: 0.235)]
    static let two: [CGPoint] = [CGPoint(x: -0.19, y: -0.19), CGPoint(x: 0.19, y: 0.19)]
    static let memberScale: CGFloat = 0.57
    static let cutout: CGFloat = 0.062

    var body: some View {
        ZStack {
            switch members.count {
            case 0:
                OwlMascotView(color: "blue", size: size, state: .success)
            case 1:
                MascotCharacterView(bot: members[0], size: size, state: state)
            default:
                let shown = Array(members.prefix(3))
                let offsets = shown.count == 2 ? Self.two : Self.three
                let member = size * (shown.count == 2 ? 0.62 : Self.memberScale)
                ForEach(Array(shown.enumerated()), id: \.offset) { index, bot in
                    MascotCharacterView(bot: bot, size: member, state: state)
                        .modifier(CutOut(width: index == 0 ? 0 : size * Self.cutout, color: background))
                        .offset(x: offsets[index].x * size, y: offsets[index].y * size)
                }
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// A background-coloured outline around a mascot's own silhouette, so it
/// reads as cut out of whatever is behind it: the mascot's alpha, filled
/// with the background and stamped around a ring.
private struct CutOut: ViewModifier {
    let width: CGFloat
    let color: Color

    func body(content: Content) -> some View {
        if width <= 0 {
            content
        } else {
            content.background {
                ZStack {
                    ForEach(0..<16, id: \.self) { i in
                        let a = Double(i) / 16 * 2 * .pi
                        color
                            .mask(content)
                            .offset(x: cos(a) * width, y: sin(a) * width)
                    }
                    color.mask(content)
                }
            }
        }
    }
}

/// A still mascot for the places that only render snapshots: the widgets and
/// the Live Activity. A bot's chat draws its own character; anything else
/// (a room, no chat at all) draws the owl in `color`.
struct MascotStill: View {
    var chat: Chat?
    var color: String
    var look: CompleteMascotLook = MascotLook.owl.complete
    var skin: MascotSkin = .none
    var state: MausState = .idle
    var size: CGFloat = 52
    var comets = false
    /// The clock for the comets' phase; a different date is a different frame.
    var at: Date = Date()

    var body: some View {
        MascotComets(size: size, active: comets, at: at) {
            if case let .bot(bot)? = chat {
                MascotCharacterView(bot: bot, size: size, state: state)
            } else {
                MascotCharacterView(look: look, color: color, skin: skin, size: size, state: state)
            }
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Shadow on light skins

private struct MascotShadowKey: EnvironmentKey {
    static let defaultValue: MascotShadowTone? = nil
}

extension EnvironmentValues {
    /// The skin's mascot drop shadow (`--mascot-filter`), nil on a dark skin.
    /// ThemeRoot sets it from the skin; the widgets draw without it.
    var mascotShadow: MascotShadowTone? {
        get { self[MascotShadowKey.self] }
        set { self[MascotShadowKey.self] = newValue }
    }
}

/// The desktop's `--mascot-filter` on every character (#186, #204): on a
/// light skin, three drop shadows that follow the silhouette (0 0 1px and
/// 0 1px 2px in the skin's shadow colour, 0 3px 8px in its wide one), so a
/// white mascot reads on a light surface with no disc behind it. Each layer
/// shadows what the ones before drew, as a CSS filter list does; a CSS blur
/// of b pt is a Gaussian of b / 2, SwiftUI's shadow radius.
struct MascotDropShadow: ViewModifier {
    @Environment(\.mascotShadow) private var tone

    func body(content: Content) -> some View {
        if let tone {
            let layers = MascotShadowTone.layers
            content
                .compositingGroup()
                .shadow(color: Self.color(tone, layers[0].wide), radius: layers[0].blur / 2, x: 0, y: layers[0].y)
                .shadow(color: Self.color(tone, layers[1].wide), radius: layers[1].blur / 2, x: 0, y: layers[1].y)
                .shadow(color: Self.color(tone, layers[2].wide), radius: layers[2].blur / 2, x: 0, y: layers[2].y)
        } else {
            content
        }
    }

    private static func color(_ tone: MascotShadowTone, _ wide: Bool) -> Color {
        let c = wide ? tone.wide : tone.color
        return Color(.sRGB, red: c.red, green: c.green, blue: c.blue, opacity: c.alpha)
    }
}
