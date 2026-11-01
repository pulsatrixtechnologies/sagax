// A frame of the bot's computer in the transcript.
import SwiftUI
import CompanionCore
import UIKit

/// A frame of the bot's computer. In the paged shape the pixels are not in
/// the transcript — they are fetched here, once, when the row appears.
struct ScreenShot: View {
    @Environment(\.themePalette) var themePalette
    let threadId: String
    let message: Message
    @EnvironmentObject private var session: Session
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            } else {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Theme.card)
                    .frame(height: 160)
                    .overlay { ProgressView() }
            }
        }
        .task {
            guard image == nil else { return }
            let data: Data?
            if let inline = message.png {
                // a few hundred KB of base64 per frame: off the main thread
                data = await Task.detached(priority: .userInitiated) { Data(base64Encoded: inline) }.value
            } else if message.hasImage == true {
                data = await session.image(threadId: threadId, messageId: message.id)
            } else {
                data = nil
            }
            // decoded off the main thread, not on the first draw
            if let data { image = await ImageDecoding.prepared(data) }
        }
    }
}
