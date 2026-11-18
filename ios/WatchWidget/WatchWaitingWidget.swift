import CompanionCore
import SwiftUI
import WidgetKit

private struct WaitingEntry: TimelineEntry {
    let date: Date
    let count: Int?
}

private struct WaitingProvider: TimelineProvider {
    func placeholder(in context: Context) -> WaitingEntry { WaitingEntry(date: Date(), count: 2) }

    func getSnapshot(in context: Context, completion: @escaping (WaitingEntry) -> Void) {
        if context.isPreview { completion(placeholder(in: context)); return }
        Task { completion(await read()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WaitingEntry>) -> Void) {
        Task {
            let entry = await read()
            completion(Timeline(entries: [entry], policy: .after(entry.date.addingTimeInterval(15 * 60))))
        }
    }

    private func read() async -> WaitingEntry {
        guard let client = try? await WatchPairingStore.loadClient() else { return WaitingEntry(date: Date(), count: nil) }
        let payload = try? await WatchWaitingList.read(using: client)
        return WaitingEntry(date: Date(), count: payload?.waiting.count)
    }
}

@main
struct WatchWaitingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WatchWaitingLink.widgetKind, provider: WaitingProvider()) { entry in
            WaitingFace(entry: entry)
                .containerBackground(for: .widget) { Color.clear }
                .widgetURL(WatchWaitingLink.url)
        }
        .configurationDisplayName("Needs you")
        .description("Items waiting for your answer.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

private struct WaitingFace: View {
    @Environment(\.widgetFamily) private var family
    let entry: WaitingEntry

    var body: some View {
        let count = entry.count.map { $0.formatted() } ?? "?"
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "tray").font(.caption2)
                    Text(count).font(.headline)
                }
            }.accessibilityLabel(Text("Needs you: \(count)"))
        default:
            Label("Needs you: \(count)", systemImage: "tray")
        }
    }
}
