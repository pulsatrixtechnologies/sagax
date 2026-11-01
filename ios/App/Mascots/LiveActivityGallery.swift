// DEBUG only: the Live Activity's own views (Shared/BotActivityViews.swift)
// in the shapes and sizes the system gives them, for headless captures:
// `-mascotGallery live-activity`. Synthetic bots and words only.
//
// The island shapes are drawn at Apple's documented sizes for a 6.3" iPhone
// (compact 37 pt tall, expanded about 371 x 160 pt with its regions); the
// real island is captured separately from a simulator with
// `-liveActivityPreview` (docs/screenshots/ios-reliability/README.md).
import SwiftUI
#if DEBUG
import CompanionCore

struct LiveActivityGallery: View {
    private let scout = BotActivityAttributes(botId: "g-scout", threadId: "t1", name: "Scout", color: "blue", mascotLook: nil, mascotSkin: nil)
    private let juniper = BotActivityAttributes(botId: "g-juniper", threadId: "t2", name: "Juniper", color: "green", mascotLook: nil, mascotSkin: nil)
    private let pip = BotActivityAttributes(botId: "g-pip", threadId: "t3", name: "Pip", color: "purple", mascotLook: MascotLook(character: .shape, shape: .squircle), mascotSkin: nil)

    private var since: Date { Date().addingTimeInterval(-372) }

    private var asking: BotActivityContent {
        let card = try? JSONDecoder().decode(OptionCard.self, from: Data(#"{"title":"Run a command","subtitle":"","options":["Allow","Deny"],"requestId":"g-ask","tool":"Bash"}"#.utf8))
        return BotActivityContent(face: "alerting", kind: "needsYou", headline: "Scout needs you", line: "Run npm install in the web project?", threadId: "t1", card: card, since: since)
    }
    private var working: BotActivityContent {
        BotActivityContent(face: "working", kind: "working", headline: "Juniper is working", line: "Reading the quarterly report", threadId: "t2", card: nil, since: since)
    }
    private var shapeWorking: BotActivityContent {
        BotActivityContent(face: "thinking", kind: "working", headline: "Pip is working", line: "Comparing three suppliers", threadId: "t3", card: nil, since: since)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                label("Dynamic Island, compact")
                compact(scout, asking, stale: false)
                compact(juniper, working, stale: false)
                compact(pip, shapeWorking, stale: true)
                label("Dynamic Island, minimal")
                HStack(spacing: 10) {
                    minimal(scout, asking)
                    minimal(juniper, working)
                }
                label("Dynamic Island, expanded")
                expanded(scout, asking, stale: false)
                expanded(juniper, working, stale: false)
                expanded(juniper, LiveActivityPlan.done(working), stale: false)
                label("Lock screen: light, dark, stale, done")
                lock(scout, asking, stale: false).environment(\.colorScheme, .light)
                lock(juniper, working, stale: false).environment(\.colorScheme, .dark)
                lock(pip, shapeWorking, stale: true).environment(\.colorScheme, .light)
                lock(scout, LiveActivityPlan.answered(asking, choice: "Allow"), stale: false).environment(\.colorScheme, .dark)
            }
            .padding(.bottom, 40)
        }
    }

    private func label(_ text: String) -> some View {
        Text(verbatim: text)
            .font(.system(size: 11))
            .foregroundStyle(Color.white.opacity(0.6))
    }

    private func compact(_ a: BotActivityAttributes, _ s: BotActivityContent, stale: Bool) -> some View {
        HStack(spacing: 0) {
            MascotStill(color: a.color, look: a.look, skin: a.mascotSkin ?? .none, state: MausState(rawValue: s.face) ?? .idle, size: 22)
                .opacity(stale ? 0.6 : 1)
                .padding(.leading, 9)
            Spacer(minLength: 126) // the camera and sensors
            BotActivityGlyph(attributes: a, state: s, isStale: stale)
                .padding(.trailing, 12)
        }
        .frame(width: 250, height: 37)
        .background(Capsule().fill(Color.black))
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.12)))
        .frame(maxWidth: .infinity)
    }

    private func minimal(_ a: BotActivityAttributes, _ s: BotActivityContent) -> some View {
        MascotStill(color: a.color, look: a.look, skin: a.mascotSkin ?? .none, state: MausState(rawValue: s.face) ?? .idle, size: 20)
            .frame(width: 37, height: 37)
            .background(Circle().fill(Color.black))
            .overlay(Circle().strokeBorder(Color.white.opacity(0.12)))
    }

    private func expanded(_ a: BotActivityAttributes, _ s: BotActivityContent, stale: Bool) -> some View {
        VStack(spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                BotActivityFace(attributes: a, state: s, isStale: stale, size: 40)
                    .padding(.leading, 4)
                    .padding(.top, 2)
                BotActivityIslandCenter(attributes: a, state: s)
                    .padding(.top, 2)
                BotActivityClock(state: s, isStale: stale)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.6))
                    .frame(maxWidth: 64, alignment: .trailing)
                    .padding(.trailing, 4)
                    .padding(.top, 4)
            }
            BotActivityIslandBottom(attributes: a, state: s, isStale: stale)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
        .frame(width: 371)
        .background(RoundedRectangle(cornerRadius: 44, style: .continuous).fill(Color.black))
        .overlay(RoundedRectangle(cornerRadius: 44, style: .continuous).strokeBorder(Color.white.opacity(0.12)))
        .frame(maxWidth: .infinity)
    }

    private func lock(_ a: BotActivityAttributes, _ s: BotActivityContent, stale: Bool) -> some View {
        BotActivityLockScreenCard(attributes: a, state: s, isStale: stale)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .frame(width: 370)
            .frame(maxWidth: .infinity)
    }
}
#endif
