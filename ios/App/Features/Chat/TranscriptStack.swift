// Chooses LazyVStack (default) or VStack (DEBUG `-transcript-eager` measure)
// for the chat transcript without duplicating the row tree.
import SwiftUI

struct TranscriptStack<Content: View>: View {
    let lazy: Bool
    /// A live text size change leaves a lazy stack with the row heights it
    /// measured at the old size: the content comes out the wrong height and
    /// the transcript draws nothing (#4490, a 12-row form switched large,
    /// largest, large, largest). Keying the stack on the size drops those
    /// cached heights; the follow model pins the end again as the content
    /// size settles.
    @Environment(\.dynamicTypeSize) private var typeSize
    @ViewBuilder let content: () -> Content

    var body: some View {
        if lazy {
            LazyVStack(alignment: .leading, spacing: 0, content: content).id(typeSize)
        } else {
            VStack(alignment: .leading, spacing: 0, content: content).id(typeSize)
        }
    }
}
