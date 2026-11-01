// The widget extension: the bot's Live Activity in the Dynamic Island and
// on the lock screen, and the home-screen widgets that render the updates
// snapshot. The face is the mascot engine's resting face for the state —
// the system renders a snapshot, so it cannot move here, but it changes
// with every update.
import ActivityKit
import CompanionCore
import SwiftUI
import WidgetKit

@main
struct SagaxWidgets: WidgetBundle {
    var body: some Widget {
        // iOS 18 also draws the activity on the watch, in its own small layout
        BotActivityWidget()
        NeedsYouWidget()
        UpdatesDigestWidget()
        WorkingMonitorWidget()
        if #available(iOS 17.0, *) {
            BotWidget()
        }
    }
}

struct BotActivityWidget: Widget {
    /// iOS 18 also draws the activity on the watch (Smart Stack, and full
    /// screen there when it updates): its own small layout, not the phone's
    /// card scaled down.
    var body: some WidgetConfiguration {
        if #available(iOS 18.0, *) {
            return Self.configuration().supplementalActivityFamilies([.small])
        } else {
            return Self.configuration()
        }
    }

    static func configuration() -> ActivityConfiguration<BotActivityAttributes> {
        ActivityConfiguration(for: BotActivityAttributes.self) { context in
            // The lock-screen card wears the app's skin (app group,
            // SharedTheme) and paints its own background in the same skin
            // as its ink; the Dynamic Island below is always black.
            ActivityContentView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    BotActivityFace(attributes: context.attributes, state: context.state, isStale: context.staleCompat, size: 40)
                        .padding(.leading, 4)
                        .padding(.top, 2)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    BotActivityClock(state: context.state, isStale: context.staleCompat)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.white.opacity(0.6))
                        .frame(maxWidth: 64, alignment: .trailing)
                        .padding(.trailing, 4)
                        .padding(.top, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    BotActivityIslandCenter(attributes: context.attributes, state: context.state)
                        .padding(.top, 2)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    BotActivityIslandBottom(attributes: context.attributes, state: context.state, isStale: context.staleCompat)
                }
            } compactLeading: {
                MascotStill(color: context.attributes.color, look: context.attributes.look, skin: context.attributes.mascotSkin ?? .none, state: MausState(rawValue: context.state.face) ?? .idle, size: 22)
                    .opacity(context.staleCompat ? 0.6 : 1)
            } compactTrailing: {
                BotActivityGlyph(attributes: context.attributes, state: context.state, isStale: context.staleCompat)
            } minimal: {
                MascotStill(color: context.attributes.color, look: context.attributes.look, skin: context.attributes.mascotSkin ?? .none, state: MausState(rawValue: context.state.face) ?? .idle, size: 20)
                    .opacity(context.staleCompat ? 0.6 : 1)
            }
            .keylineTint(MausPalette.color(context.attributes.color))
        }
    }
}

/// The lock screen's card on the phone; on the watch, its own small layout.
private struct ActivityContentView: View {
    let context: ActivityViewContext<BotActivityAttributes>

    var body: some View {
        if #available(iOS 18.0, *) {
            FamilyActivityView(context: context)
        } else {
            BotActivityLockScreenCard(attributes: context.attributes, state: context.state, isStale: context.staleCompat)
        }
    }
}

@available(iOS 18.0, *)
private struct FamilyActivityView: View {
    let context: ActivityViewContext<BotActivityAttributes>
    @Environment(\.activityFamily) private var family

    var body: some View {
        if family == .small {
            BotActivityWatchCard(attributes: context.attributes, state: context.state, isStale: context.staleCompat)
        } else {
            BotActivityLockScreenCard(attributes: context.attributes, state: context.state, isStale: context.staleCompat)
        }
    }
}

extension ActivityViewContext {
    /// The system's stale flag (iOS 16.2); 16.1 has no stale dates at all.
    var staleCompat: Bool {
        if #available(iOS 16.2, *) { return isStale }
        return false
    }
}
