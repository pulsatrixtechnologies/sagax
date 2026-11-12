// Jump to latest (feature parity matrix WP4, MS14), the phone's bottom
// follow and "Jump to latest" pill of src/components/ChatView.tsx: the
// transcript follows new text while the reader is at the end; scrolling up
// (a drag, never new content pushing the end down) stops the follow, and
// reaching the end again re-arms it. While it is off, a glass arrow circle
// over the transcript takes the reader back to the newest message in one
// tap, streaming or not. The model watches the transcript's UIScrollView
// and publishes only when the follow flips, so scrolling does not redraw
// the chat.
import CompanionCore
import SwiftUI
import UIKit

@MainActor
final class BottomFollow: ObservableObject {
    /// True while the transcript follows its end (`follow`).
    @Published private(set) var following = true

    /// `BOTTOM_FOLLOW_THRESHOLD`, in points (4 px on the desktop; a little
    /// more on a touch screen, where the end bounces).
    static let threshold: CGFloat = 8

    private weak var scrollView: UIScrollView?
    private var observations: [NSKeyValueObservation] = []

    /// Set by `hold()`: the end does not re-arm the follow on its own, and
    /// the transcript was moved by the app, not left by the reader, so no
    /// Jump to latest (the desktop's follow only breaks on the reader's
    /// wheel, drag or PageUp).
    @Published private(set) var held = false

    /// The reader asked for the end (the jump button, a send, a new thread).
    func resume() {
        if held { held = false }
        if !following { following = true }
    }

    /// A programmatic scroll to an earlier row (the parity launch): stop
    /// following, and do not take it back when the scroll still sits at the
    /// end for a moment, or the content-size pin pulls it back down before
    /// the scroll lands. A drag or `resume()` ends the hold.
    func hold() {
        held = true
        pause()
    }

    /// Something else scrolled the transcript away (a search hit, a reply
    /// quote, the pinned banner): stop following until the end is reached.
    func pause() { if following { following = false } }

    func attach(_ view: UIScrollView) {
        guard scrollView !== view else { return }
        observations = []
        scrollView = view
        view.panGestureRecognizer.addTarget(self, action: #selector(dragged(_:)))
        observations.append(view.observe(\.contentOffset, options: [.new]) { [weak self] scroll, _ in
            MainActor.assumeIsolated {
                self?.check(scroll)
                Self.rescueBlank(scroll)
            }
        })
        // LazyVStack grows contentSize as rows appear. While following, pin
        // to the end so open/stream/settle still land on the newest message.
        observations.append(view.observe(\.contentSize, options: [.new]) { [weak self] scroll, _ in
            MainActor.assumeIsolated {
                self?.pinToBottomIfFollowing(scroll)
                // drawn rows shorter than their estimates can leave the
                // offset past the content without the offset moving
                Self.rescueBlank(scroll)
            }
        })
        pinToBottomIfFollowing(view)
    }

    private func distance(_ scroll: UIScrollView) -> CGFloat {
        let visibleBottom = scroll.contentOffset.y + scroll.bounds.height - scroll.adjustedContentInset.bottom
        return scroll.contentSize.height - visibleBottom
    }

    /// The at-end check of `onScroll`: reaching the end re-arms the follow.
    private func check(_ scroll: UIScrollView) {
        if !following, !held, distance(scroll) <= Self.threshold { following = true }
    }

    /// A short transcript is pinned too: SwiftUI bottom aligns it with a top
    /// inset, and its resting offset is `-inset.top` (#3992).
    private func pinToBottomIfFollowing(_ scroll: UIScrollView) {
        guard following else { return }
        if let y = TranscriptScrollPin.followOffset(Self.geometry(scroll), userScrolling: Self.userScrolling(scroll)) {
            scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: y), animated: false)
        }
    }

    /// A scroll to the bottom computed on a lazy stack's estimated row
    /// heights can leave the offset past the content: nothing of the
    /// transcript on screen (#3992). Bring it back to the nearest resting
    /// offset, following or not.
    private static func rescueBlank(_ scroll: UIScrollView) {
        if let y = TranscriptScrollPin.blankRescueOffset(geometry(scroll), userScrolling: userScrolling(scroll)) {
            scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: y), animated: false)
        }
    }

    private static func geometry(_ scroll: UIScrollView) -> TranscriptScrollGeometry {
        let inset = scroll.adjustedContentInset
        return TranscriptScrollGeometry(
            offsetY: scroll.contentOffset.y,
            contentHeight: scroll.contentSize.height,
            boundsHeight: scroll.bounds.height,
            insetTop: inset.top,
            insetBottom: inset.bottom
        )
    }

    private static func userScrolling(_ scroll: UIScrollView) -> Bool {
        scroll.isTracking || scroll.isDragging || scroll.isDecelerating
    }

    /// An upward drag away from the end breaks the follow, like an upward
    /// wheel or PageUp on the desktop.
    @objc private func dragged(_ pan: UIPanGestureRecognizer) {
        guard let scroll = pan.view as? UIScrollView, pan.state == .changed || pan.state == .ended else { return }
        if held { held = false }
        if pan.translation(in: scroll).y > 0, distance(scroll) > Self.threshold { following = false }
    }
}

/// Finds the scroll view the transcript sits in and hands it to the model.
struct BottomFollowProbe: UIViewRepresentable {
    let model: BottomFollow

    func makeUIView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.model = model
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: ProbeView, context: Context) {
        view.model = model
        view.attachIfPossible()
    }

    final class ProbeView: UIView {
        weak var model: BottomFollow?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            attachIfPossible()
        }

        func attachIfPossible() {
            var view = superview
            while let current = view, !(current is UIScrollView) { view = current.superview }
            guard let scroll = view as? UIScrollView else { return }
            let model = model
            MainActor.assumeIsolated { model?.attach(scroll) }
        }
    }
}

/// The glass circle that takes the reader back to the newest message.
struct JumpToLatestButton: View {
    @Environment(\.themePalette) var themePalette
    let action: () -> Void
    @State private var taps = 0

    var body: some View {
        Button {
            taps += 1
            action()
        } label: {
            Image(systemName: "arrow.down")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
                .frame(width: Theme.Metric.glassLarge, height: Theme.Metric.glassLarge)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .themeGlass(Circle())
        .chatGlassRim(Circle())
        .accessibilityLabel(Text("Jump to latest messages"))
        .accessibilityIdentifier("jump-to-latest")
        .feedback(.selection, trigger: taps)
        .transition(.scale(scale: 0.6).combined(with: .opacity))
    }
}
