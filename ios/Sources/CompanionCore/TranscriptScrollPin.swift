// Where the chat transcript's scroll offset may rest, for the bottom follow
// of the phone's chat (JumpToLatest.swift). The transcript is a lazy stack
// whose row heights are estimates until the rows are drawn; a scroll to the
// bottom computed on those estimates can leave the offset past the content,
// so the screen shows the header, an empty column and the composer. The
// rules here put the offset back where the newest row is on screen.
//
// A short transcript is bottom aligned by SwiftUI through a top inset as
// tall as the free space, so its only resting offset is `-insetTop`: the
// same formula as a long one (`contentHeight - boundsHeight + insetBottom`)
// once the result is held at or above `-insetTop`.
import CoreGraphics

public struct TranscriptScrollGeometry: Equatable, Sendable {
    public var offsetY: CGFloat
    public var contentHeight: CGFloat
    public var boundsHeight: CGFloat
    /// The scroll view's adjusted insets (safe area and SwiftUI's own).
    public var insetTop: CGFloat
    public var insetBottom: CGFloat

    public init(offsetY: CGFloat, contentHeight: CGFloat, boundsHeight: CGFloat, insetTop: CGFloat, insetBottom: CGFloat) {
        self.offsetY = offsetY
        self.contentHeight = contentHeight
        self.boundsHeight = boundsHeight
        self.insetTop = insetTop
        self.insetBottom = insetBottom
    }

    /// The offset with the first row at the top of the visible area.
    public var topOffset: CGFloat { -insetTop }

    /// The offset with the newest row at the bottom of the visible area.
    /// A transcript shorter than the visible area rests at `topOffset`.
    public var endOffset: CGFloat { max(topOffset, contentHeight - boundsHeight + insetBottom) }

    /// True when not one point of the content is in the visible area: the
    /// content starts below its bottom edge or ends above its top edge.
    public var showsNoContent: Bool {
        let visibleTop = offsetY + insetTop
        let visibleBottom = offsetY + boundsHeight - insetBottom
        return visibleBottom <= 0 || visibleTop >= contentHeight
    }
}

public enum TranscriptScrollPin {
    /// Moves smaller than this are rounding, not a scroll.
    static let tolerance: CGFloat = 0.5

    /// The content grew or shrank while the transcript follows its end: the
    /// offset that keeps the newest row in view, short transcript or long,
    /// or nil when it is there already or the reader's finger is on it.
    public static func followOffset(_ geometry: TranscriptScrollGeometry, userScrolling: Bool) -> CGFloat? {
        guard !userScrolling else { return nil }
        let target = geometry.endOffset
        return abs(geometry.offsetY - target) > tolerance ? target : nil
    }

    /// The offset moved: when it left the content entirely (a scroll to the
    /// bottom computed on estimated row heights), the nearest resting offset,
    /// whether or not the transcript follows its end. Nil while the content
    /// is in view or the reader is scrolling (a pull past the end bounces).
    public static func blankRescueOffset(_ geometry: TranscriptScrollGeometry, userScrolling: Bool) -> CGFloat? {
        guard !userScrolling, geometry.showsNoContent else { return nil }
        let target = min(max(geometry.offsetY, geometry.topOffset), geometry.endOffset)
        return abs(geometry.offsetY - target) > tolerance ? target : nil
    }
}
