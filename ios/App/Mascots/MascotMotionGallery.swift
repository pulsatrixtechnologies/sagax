// DEBUG only: `-mascotGallery motion`. Every character animated, as a chat
// header and the bot panel draw it, while the state they wear changes every
// 1.6 s (idle, thinking, working, happy, alerting), so a screen recording
// shows the transitions the app plays: the assembled body through a mood
// change, the live/still switch at the 44 pt threshold, the pace at rest.
// Synthetic colours only.
import SwiftUI
#if DEBUG
import CompanionCore

struct MascotMotionGallery: View {
    static let cycle: [MausState] = [.idle, .thinking, .working, .happy, .alerting]
    @State private var step = 0
    private let timer = Timer.publish(every: 1.6, on: .main, in: .common).autoconnect()

    private static let looks: [(String, CompleteMascotLook, String)] = [
        ("owl", MascotLook.owl.complete, "green"),
        ("circle", CompleteMascotLook(character: .shape, shape: .circle), "blue"),
        ("squircle", CompleteMascotLook(character: .shape, shape: .squircle), "violet"),
        ("star", CompleteMascotLook(character: .shape, shape: .star), "honey"),
        ("ghost", CompleteMascotLook(character: .shape, shape: .ghost), "white"),
        ("pumpkin", CompleteMascotLook(character: .shape, shape: .pumpkin), "tomato"),
        ("trombi", CompleteMascotLook(character: .trombi), "blue"),
        ("bunbu", CompleteMascotLook(character: .bunbu), "pink"),
        ("frog", CompleteMascotLook(character: .frog), "green"),
        ("crab", CompleteMascotLook(character: .crab), "tomato"),
        ("grump", CompleteMascotLook(character: .grump), "blue"),
        ("ogre", CompleteMascotLook(character: .ogre), "green"),
    ]

    var body: some View {
        let state = Self.cycle[step % Self.cycle.count]
        VStack(alignment: .leading, spacing: 10) {
            Text(verbatim: "state: \(state.rawValue)")
                .font(.system(size: 12, weight: .semibold).monospaced())
                .foregroundStyle(.white.opacity(0.8))
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(88), spacing: 4), count: 4), alignment: .leading, spacing: 6) {
                ForEach(Self.looks, id: \.0) { name, look, color in
                    VStack(spacing: 2) {
                        MascotCharacterView(look: look, color: color, size: 64, state: state, animated: true)
                            .frame(width: 84, height: 84)
                        Text(verbatim: name).font(.system(size: 9)).foregroundStyle(.white.opacity(0.6))
                    }
                }
            }
            Text(verbatim: "header sizes: 28 · 36 · 44 · 52")
                .font(.system(size: 11)).foregroundStyle(.white.opacity(0.6))
            HStack(alignment: .bottom, spacing: 14) {
                ForEach([28, 36, 44, 52] as [CGFloat], id: \.self) { size in
                    MascotCharacterView(look: CompleteMascotLook(character: .shape, shape: .squircle), color: "violet", size: size, state: state, animated: true)
                }
                ForEach([28, 44] as [CGFloat], id: \.self) { size in
                    MascotCharacterView(look: MascotLook.owl.complete, color: "green", size: size, state: state, animated: true)
                }
            }
        }
        .onReceive(timer) { _ in step += 1 }
    }
}
#endif
