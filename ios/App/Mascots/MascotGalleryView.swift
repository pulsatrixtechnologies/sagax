// DEBUG only: every character, skin and a few colours at the reference's
// frame sizes (24, 42, 85 pt), for comparing the phone's renders with the
// desktop's. Launch with `-mascotGallery owl|shape|trombi|shiba|frog|crab|group`; the same
// `ios/parity/mascot-gallery.render.ts`, with the same layout.
import SwiftUI
#if DEBUG
import CompanionCore
import UIKit

struct MascotGalleryView: View {
    @Environment(\.themePalette) var themePalette
    let page: String

    static var requestedPage: String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let i = arguments.firstIndex(of: "-mascotGallery") else { return nil }
        return i + 1 < arguments.count ? arguments[i + 1] : "owl"
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color(hex: "#141414")
            VStack(alignment: .leading, spacing: 10) {
                Text(verbatim: "iOS · \(page)")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                switch page {
                case "shape": shapes
                case "shape-moves": ShapeMovesGallery()
                case "shape-volume": ShapeVolumeGallery()
                case "trombi": trombis
                case "shiba": shibas
                case "shiba-hd": shibaHD
                case "frog": frogs
                case "crab": crabs
                case "group": groups
                case "live-activity": LiveActivityGallery()
                case "motion": MascotMotionGallery()
                default: owls
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 60)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .ignoresSafeArea()
        .preferredColorScheme(.dark)
    }

    private func label(_ text: String) -> some View {
        Text(verbatim: text)
            .font(.system(size: 11))
            .foregroundStyle(Color.white.opacity(0.6))
    }

    private func row<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            label(title)
            HStack(alignment: .bottom, spacing: 8) { content() }
        }
    }

    private func character(_ look: CompleteMascotLook, _ color: String, _ skin: MascotSkin = .none, _ size: CGFloat, _ state: MausState = .idle, hd: Bool = false, animated: Bool = false) -> some View {
        MascotCharacterView(look: look, color: color, skin: skin, size: size, state: state, animated: animated, hd: hd)
    }

    // MARK: pages

    private var owls: some View {
        let owl = MascotLook.owl.complete
        return VStack(alignment: .leading, spacing: 10) {
            ForEach(MascotSkin.allCases, id: \.self) { skin in
                row(skin.rawValue) {
                    character(owl, "green", skin, 24)
                    character(owl, "green", skin, 42)
                    character(owl, "blue", skin, 42)
                    character(owl, "black", skin, 42)
                    character(owl, "white", skin, 42)
                    character(owl, "green", skin, 85)
                }
            }
        }
    }

    private var shapes: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(ShapeSkin.allCases, id: \.self) { skin in
                row(skin.rawValue) {
                    ForEach(MascotShape.allCases, id: \.self) { shape in
                        character(CompleteMascotLook(character: .shape, shape: shape, shapeSkin: skin), "purple", .none, 36)
                    }
                }
            }
            row("sizes, colours") {
                character(CompleteMascotLook(character: .shape), "red", .none, 24)
                character(CompleteMascotLook(character: .shape), "red", .none, 42)
                character(CompleteMascotLook(character: .shape), "red", .none, 85)
                character(CompleteMascotLook(character: .shape, shape: .cloud, shapeSkin: .glossy), "blue", .none, 85)
            }
            row("moods: thinking, working, happy, sleeping") {
                character(CompleteMascotLook(character: .shape, shape: .squircle), "teal", .none, 60, .thinking)
                character(CompleteMascotLook(character: .shape, shape: .squircle), "teal", .none, 60, .working)
                character(CompleteMascotLook(character: .shape, shape: .squircle), "teal", .none, 60, .happy)
                character(CompleteMascotLook(character: .shape, shape: .squircle), "teal", .none, 60, .sleeping)
            }
        }
    }

    private var trombis: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(TrombiSkin.allCases, id: \.self) { skin in
                row(skin.rawValue) {
                    let look = CompleteMascotLook(character: .trombi, trombiSkin: skin)
                    character(look, "green", .none, 24)
                    character(look, "green", .none, 42)
                    character(look, "green", .none, 85)
                }
            }
            row("poses: idle, think, celebrate, sleep") {
                let look = CompleteMascotLook(character: .trombi)
                character(look, "green", .none, 85, .idle)
                character(look, "green", .none, 85, .working)
                character(look, "green", .none, 85, .happy)
                character(look, "green", .none, 85, .sleeping)
            }
        }
    }

    /// HD mascots (#968): the painted shiba, its loop, stills and the small bust; the vector look beside it.
    private var shibaHD: some View {
        VStack(alignment: .leading, spacing: 10) {
            row("HD: idle (loop), thinking, sleeping, 42 pt bust") {
                let look = CompleteMascotLook(character: .shiba)
                character(look, "orange", .none, 85, .idle, hd: true, animated: true)
                character(look, "orange", .none, 60, .thinking, hd: true)
                character(look, "orange", .none, 60, .sleeping, hd: true)
                character(look, "orange", .none, 42, .happy, hd: true)
            }
            row("vector (HD off): idle, thinking, sleeping, 42 pt") {
                let look = CompleteMascotLook(character: .shiba)
                character(look, "orange", .none, 85, .idle)
                character(look, "orange", .none, 60, .thinking)
                character(look, "orange", .none, 60, .sleeping)
                character(look, "orange", .none, 42, .happy)
            }
            // every loop the art ships, each playing (48 pt and up, Reduce Motion off)
            row("HD loops, 56 pt: idle, walk, jump, turn, happy, sad") {
                ForEach(HdLoop.allCases, id: \.self) { loop in
                    HdOrVector(character: .shiba, key: .loop(loop), size: 56, animated: true) { Color.clear }
                        .frame(width: 56, height: 56)
                }
            }
            row("HD: happy (loop), surprised, angry, 24 pt") {
                let look = CompleteMascotLook(character: .shiba)
                character(look, "orange", .none, 85, .happy, hd: true, animated: true)
                character(look, "orange", .none, 60, .surprised, hd: true)
                character(look, "orange", .none, 60, .angry, hd: true)
                character(look, "orange", .none, 24, .idle, hd: true)
            }
        }
    }

    private var shibas: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(ShibaSkin.allCases, id: \.self) { skin in
                row(skin.rawValue) {
                    let look = CompleteMascotLook(character: .shiba, shibaSkin: skin)
                    character(look, "orange", .none, 24)
                    character(look, "orange", .none, 42)
                    character(look, "blue", .none, 42)
                    character(look, "orange", .none, 85)
                }
            }
            row("faces: thinking, happy, laughing, sad, sleeping") {
                let look = CompleteMascotLook(character: .shiba)
                ForEach([MausState.thinking, .happy, .laughing, .sad, .sleeping], id: \.rawValue) { state in
                    character(look, "orange", .none, 60, state)
                }
            }
            row("idle and walk, animated") {
                ShibaMascotView(color: "orange", size: 85, animated: true)
                ShibaMascotView(color: "orange", size: 85, animated: true, walking: true)
            }
        }
    }

    private var frogs: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(FrogSkin.allCases, id: \.self) { skin in
                row(skin.rawValue) {
                    let look = CompleteMascotLook(character: .frog, frogSkin: skin)
                    character(look, "green", .none, 24)
                    character(look, "green", .none, 42)
                    character(look, "blue", .none, 42)
                    character(look, "green", .none, 85)
                }
            }
            row("faces: thinking, happy, laughing, sad, sleeping") {
                let look = CompleteMascotLook(character: .frog)
                ForEach([MausState.thinking, .happy, .laughing, .sad, .sleeping], id: \.rawValue) { state in
                    character(look, "green", .none, 60, state)
                }
            }
            row("idle, throat puff and hop, animated") {
                FrogMascotView(color: "green", size: 85, animated: true)
                FrogMascotView(color: "green", size: 85, expression: .curious, animated: true)
                FrogMascotView(color: "green", size: 85, animated: true, hopping: true)
            }
        }
    }

    private var crabs: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(CrabSkin.allCases, id: \.self) { skin in
                row(skin.rawValue) {
                    let look = CompleteMascotLook(character: .crab, crabSkin: skin)
                    character(look, "orange", .none, 24)
                    character(look, "orange", .none, 42)
                    character(look, "blue", .none, 42)
                    character(look, "orange", .none, 85)
                }
            }
            row("moods: listening, speaking, sleeping") {
                let look = CompleteMascotLook(character: .crab)
                ForEach([MausState.listening, .notifying, .sleeping], id: \.rawValue) { state in
                    character(look, "orange", .none, 60, state)
                }
            }
            row("idle, animated") {
                CrabMascotView(color: "orange", size: 85, animated: true)
            }
        }
    }

    private static func bot(_ id: String, _ color: String, _ look: MascotLook?, _ skin: MascotSkin? = nil) -> Bot {
        let json = """
        {"id":"\(id)","threadId":"\(id)","name":"\(id)","title":"","description":"","notifications":true,
         "color":"\(color)","unread":false,"modelSelection":{"instanceId":"e","model":"m"},"createdAt":0}
        """
        var bot = try! JSONDecoder().decode(Bot.self, from: Data(json.utf8))
        bot.mascotLook = look
        bot.mascotSkin = skin
        return bot
    }

    private var groups: some View {
        let members = [
            Self.bot("a", "white", MascotLook(character: .shape, shape: .triangle)),
            Self.bot("b", "blue", MascotLook(character: .shape, shape: .drop)),
            Self.bot("c", "purple", MascotLook(character: .shape, shape: .circle)),
        ]
        let mixed = [Self.bot("d", "orange", nil), Self.bot("e", "teal", MascotLook(character: .trombi)), Self.bot("f", "pink", nil, .gold)]
        let picture = Bundle.main.url(forResource: "ImagePreview", withExtension: "png").flatMap { UIImage(contentsOfFile: $0.path) }
        return VStack(alignment: .leading, spacing: 10) {
            row("group 85: shapes, owls + trombi, two") {
                GroupMascotView(members: members, size: 85, background: Color(hex: "#141414"))
                GroupMascotView(members: mixed, size: 85, background: Color(hex: "#141414"))
                GroupMascotView(members: Array(members.prefix(2)), size: 85, background: Color(hex: "#141414"))
            }
            row("group 42") {
                GroupMascotView(members: members, size: 42, background: Color(hex: "#141414"))
                GroupMascotView(members: mixed, size: 42, background: Color(hex: "#141414"))
            }
            if let picture {
                row("picture: circle, rounded, square, zoom 2 @ (0.2, 0.3)") {
                    FramedPicture(image: picture, size: 85, crop: .circle)
                    FramedPicture(image: picture, size: 85, crop: .rounded)
                    FramedPicture(image: picture, size: 85, crop: .square)
                    FramedPicture(image: picture, size: 85, crop: .circle, zoom: 2, focusX: 0.2, focusY: 0.3)
                }
            }
            row("owl wings open (still), alert, sleepy") {
                OwlMascotView(color: "green", size: 85, wings: 1)
                OwlMascotView(color: "red", size: 85, state: .alert)
                OwlMascotView(color: "purple", size: 85, state: .sleepy)
            }
        }
    }
}
/// `-mascotGallery shape-moves`: the sixteen faces live, then the fourteen
/// moves, each replaying every four seconds (the desktop's Moves menu).
private struct ShapeMovesGallery: View {
    @State private var handles = ShapeMove.allCases.map { _ in OwlMascotHandle() }
    private let timer = Timer.publish(every: 4, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(78), spacing: 6), count: 4), alignment: .leading, spacing: 4) {
                ForEach(ShapeExpression.allCases, id: \.self) { face in
                    VStack(spacing: 0) {
                        ShapeMascotView(shape: .squircle, color: "cobalt", size: 46, expression: face, animated: true)
                            .frame(width: 60, height: 52)
                        Text(verbatim: face.rawValue).font(.system(size: 9)).foregroundStyle(.white.opacity(0.6))
                    }
                }
            }
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(78), spacing: 6), count: 4), alignment: .leading, spacing: 4) {
                ForEach(Array(ShapeMove.allCases.enumerated()), id: \.offset) { index, move in
                    VStack(spacing: 0) {
                        ShapeMascotView(shape: MascotShape.allCases[index % MascotShape.allCases.count], color: ["tomato", "jade", "violet", "honey"][index % 4],
                                        size: 46, animated: true, handle: handles[index])
                            .frame(width: 70, height: 62)
                        Text(verbatim: move.rawValue).font(.system(size: 9)).foregroundStyle(.white.opacity(0.6))
                    }
                }
            }
        }
        .onAppear { play() }
        .onReceive(timer) { _ in play() }
    }

    private func play() {
        for (index, move) in ShapeMove.allCases.enumerated() { handles[index].shape(move) }
    }
}

/// `-mascotGallery shape-volume`: the shapes in volume, live at rest and in
/// each mood, then the moves that shrink the body frozen at their middle
/// (the depth fix of #1106: a dot, a bar or a speck stays one body).
private struct ShapeVolumeGallery: View {
    private static let shrinking: [ShapeMove] = [.thinking, .sleep, .alert, .exclaim, .burst, .comet]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: "live, at rest").font(.system(size: 11)).foregroundStyle(.white.opacity(0.6))
            HStack(spacing: 2) {
                ForEach(MascotShape.allCases, id: \.self) { shape in
                    ShapeMascotView(shape: shape, color: ["tomato", "jade", "violet", "honey", "cobalt", "white", "black", "teal"][MascotShape.allCases.firstIndex(of: shape)! % 8], size: 40, animated: true)
                        .frame(width: 44, height: 46)
                }
            }
            Text(verbatim: "moods: idle, thinking, working, streaming, happy, blocked, sleeping").font(.system(size: 11)).foregroundStyle(.white.opacity(0.6))
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(84), spacing: 2), count: 4), alignment: .leading, spacing: 4) {
                ForEach(ShapeMood.allCases, id: \.self) { mood in
                    ShapeMascotView(shape: .blob, color: "cobalt", size: 72, mood: mood, animated: true)
                        .frame(width: 84, height: 80)
                }
            }
            Text(verbatim: "moves that shrink the body, at their middle: 24, 44, 96 pt").font(.system(size: 11)).foregroundStyle(.white.opacity(0.6))
            ForEach(Self.shrinking, id: \.self) { move in
                HStack(spacing: 6) {
                    Text(verbatim: move.rawValue).font(.system(size: 9)).foregroundStyle(.white.opacity(0.6)).frame(width: 44, alignment: .leading)
                    ForEach([MascotShape.pill, .blob], id: \.self) { shape in
                        frozen(shape, move, 24)
                        frozen(shape, move, 44)
                    }
                    frozen(.pill, move, 96)
                }
            }
        }
    }

    private func frozen(_ shape: MascotShape, _ move: ShapeMove, _ size: CGFloat) -> some View {
        let run = ShapeEngine(ShapeEngineState(shape: shape, expression: .neutral, color: "#F4F4F4"), now: 0, seed: 1)
        run.play(move, now: 0)
        let timing = ShapeEngineData.moveTiming[move]!
        let frame = run.frame(min(timing.duration, timing.morph + 0.6))
        let pose = ShapeVolume.grounded(ShapePose(yaw: 28, pitch: 18, roll: 8, scale: ShapeVolumeData.rest.scale, lift: ShapeVolumeData.rest.lift), shape)
        return Canvas { context, canvas in
            ShapeRenderer.draw(in: &context, canvas: canvas, box: size, frame: frame, pose: pose, shape: shape, skin: .plain, hex: "#F4F4F4")
        }
        .frame(width: size * 1.2, height: size * 1.2)
    }
}

/// The app's root, or the gallery when launched with `-mascotGallery`.
struct MascotGalleryGate<Content: View>: View {
    @Environment(\.themePalette) var themePalette
    @ViewBuilder var content: () -> Content

    var body: some View {
        if let page = MascotGalleryView.requestedPage {
            MascotGalleryView(page: page)
        } else {
            content()
        }
    }
}
#else
/// Release builds have no gallery.
struct MascotGalleryGate<Content: View>: View {
    @Environment(\.themePalette) var themePalette
    @ViewBuilder var content: () -> Content
    var body: some View { content() }
}
#endif
