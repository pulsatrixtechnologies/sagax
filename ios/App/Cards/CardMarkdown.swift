// A card's words, drawn with the chat bubble's `MarkdownText` (#5043):
// emphasis, lists and a record link as the record chip. The source is shown
// whole. A tap on the chip opens that record's sheet, the same card the
// bubble opens. Other links stay ordinary links.
import CompanionCore
import SwiftUI

struct CardMarkdown: View {
    let source: String
    @EnvironmentObject private var session: Session
    @State private var sheet: RecordSheetItem?

    var body: some View {
        MarkdownText(source: source, openLink: { (url: URL) in
            guard let ref = RecordLinks.parse(url.absoluteString) else { return .systemAction(url) }
            sheet = RecordSheetItem(ref: ref, label: RecordLinks.label(of: url.absoluteString, in: source))
            return .handled
        })
        .fixedSize(horizontal: false, vertical: true)
        .sheet(item: $sheet) { item in
            RecordCardSheet(start: item)
                .environmentObject(session)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }
}
