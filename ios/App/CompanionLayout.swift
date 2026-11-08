import SwiftUI
import UIKit

/// Readable columns for the phone-first surfaces when they run in a wider
/// iPad window. Compact windows naturally remain narrower than these caps.
enum CompanionLayout {
    /// Ask iPadOS for a large landscape window on first launch. The system
    /// clamps this to the current display and still lets the person resize or
    /// tile the app. Previously SwiftUI inferred its initial window from the
    /// 680-point roster column, which produced a tall, phone-like window.
    static let defaultWindowSize = CGSize(width: 1_366, height: 1_024)

    static let rosterWidth: CGFloat = 680
    static let chatWidth: CGFloat = 760
    /// The phone composer's cap. Only an iPad (its phone UI in a narrow
    /// window) centres the bar in the readable column; an iPhone, landscape
    /// included, keeps it 12 pt from the safe area's edges like the
    /// reference app, never boxed in the middle of a wide screen.
    static var composerMaxWidth: CGFloat {
        UIDevice.current.userInterfaceIdiom == .pad ? chatWidth : .infinity
    }
    static let headerWidth: CGFloat = 900

    /// The expanding island animation is anchored to iPhone hardware. On an
    /// iPad it reads as an unexplained floating black card. Also off unless
    /// Settings > Notifications > Live Activities (Dynamic Island) is on.
    static var supportsIslandPresentation: Bool {
        UIDevice.current.userInterfaceIdiom == .phone && LiveActivityPrefs.isEnabled
    }
}
