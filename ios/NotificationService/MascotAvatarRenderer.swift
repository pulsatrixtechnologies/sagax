import CompanionCore
import SwiftUI
import UIKit

/// A bot's mascot as a square PNG, the face of its communication
/// notification on the phone and on the watch. The same views the app and
/// the widgets draw (App/Mascots), still and in vector (no HD art in the
/// extension), on a soft disc of the bot's colour so a white or black
/// mascot reads on any lock screen. iOS crops it to a circle.
enum MascotAvatarRenderer {
    /// 120 pt at 3x: 360 px, what iOS shows at its largest, and small enough
    /// for the extension's memory.
    static let points: CGFloat = 120
    static let scale: CGFloat = 3

    static func png(_ look: PushSenderLook) async -> Data? {
        // a person's own shape is inferred by the engine before the snapshot, which runs no task
        let complete = look.resolvedLook
        if complete.character == .shape, let def = complete.avatarDef,
           ShapeEngineStill.bakedShape(complete.shape, avatarDef: def) == nil {
            _ = ShapeEngineBake.still(complete.shape, avatarDef: def, flat: complete.shapeSkin == .outline)
        }
        return await MainActor.run { render(look) }
    }

    @MainActor static func render(_ look: PushSenderLook) -> Data? {
        let renderer = ImageRenderer(content: MascotAvatarTile(look: look, size: points))
        renderer.scale = scale
        renderer.isOpaque = true
        guard let image = renderer.uiImage, let data = image.pngData(), !data.isEmpty else { return nil }
        return data
    }
}

/// The tile itself: the bot's colour, lightened, under its mascot.
struct MascotAvatarTile: View {
    let look: PushSenderLook
    let size: CGFloat

    var body: some View {
        let tint = MausPalette.color(look.color)
        ZStack {
            Color.white
            LinearGradient(colors: [tint.opacity(0.22), tint.opacity(0.42)], startPoint: .top, endPoint: .bottom)
            MascotCharacterView(
                look: look.resolvedLook, color: look.color, skin: look.resolvedSkin,
                size: size * 0.74, state: .idle, animated: false, hd: false
            )
            // a little low: the circle crop eats the top of tall mascots less
            .offset(y: size * 0.03)
        }
        .frame(width: size, height: size)
        .environment(\.colorScheme, .light)
    }
}
