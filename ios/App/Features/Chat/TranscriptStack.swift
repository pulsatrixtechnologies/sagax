// Chooses LazyVStack (default) or VStack (DEBUG `-transcript-eager` measure)
// for the chat transcript without duplicating the row tree.
import SwiftUI

struct TranscriptStack<Content: View>: View {
    let lazy: Bool
    @ViewBuilder let content: () -> Content

    var body: some View {
        if lazy {
            LazyVStack(alignment: .leading, spacing: 0, content: content)
        } else {
            VStack(alignment: .leading, spacing: 0, content: content)
        }
    }
}
