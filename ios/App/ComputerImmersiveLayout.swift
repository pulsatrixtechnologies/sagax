// Full-screen computer stages: the picture fills the window; chrome floats
// on top and auto-hides in landscape (owner, TestFlight 27).
import SwiftUI

/// Floating top and bottom chrome over a full-screen computer stage.
struct ComputerImmersiveShell<Top: View, Bottom: View, Content: View>: View {
    @ViewBuilder var top: () -> Top
    @ViewBuilder var bottom: () -> Bottom
    @ViewBuilder var content: () -> Content

    @State private var chromeVisible = true
    @State private var hideTask: Task<Void, Never>?

    var body: some View {
        GeometryReader { proxy in
            let landscape = proxy.size.width > proxy.size.height
            ZStack {
                Theme.bgComputer.ignoresSafeArea()
                content()
                    .frame(width: proxy.size.width, height: proxy.size.height)
                VStack(spacing: 0) {
                    // the proxy already sits inside the safe area: the bars pad
                    // from its edge only (#4101: adding the inset again put the
                    // top bar a status bar lower than the reference's; the
                    // reference's controls centre 31 pt under the safe area at
                    // the page margin)
                    chromeBar(landscape: landscape) {
                        top()
                            .padding(.horizontal, Theme.PhonePanel.margin)
                            .padding(.top, Theme.PhonePanel.barCentre - Theme.Metric.glassLarge / 2)
                    }
                    Spacer(minLength: 0)
                    chromeBar(landscape: landscape) {
                        bottom()
                            .padding(.horizontal, Theme.PhonePanel.margin)
                            .padding(.bottom, Theme.Computer.buttonsBottom)
                    }
                }
                .opacity(showsChrome(landscape: landscape) ? 1 : 0)
                .animation(.easeInOut(duration: 0.22), value: chromeVisible)
                .allowsHitTesting(showsChrome(landscape: landscape))
            }
            .contentShape(Rectangle())
            .onTapGesture {
                if landscape, !chromeVisible { revealChrome(landscape: landscape) }
            }
            .onAppear { revealChrome(landscape: landscape) }
            .onValueChange(of: landscape) { revealChrome(landscape: $0) }
        }
    }

    private func showsChrome(landscape: Bool) -> Bool {
        !landscape || chromeVisible
    }

    private func revealChrome(landscape: Bool) {
        chromeVisible = true
        hideTask?.cancel()
        guard landscape else { return }
        hideTask = Task {
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                withAnimation { chromeVisible = false }
            }
        }
    }

    @ViewBuilder
    private func chromeBar<Inner: View>(landscape: Bool, @ViewBuilder _ inner: () -> Inner) -> some View {
        inner()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                // portrait: the bars sit on the black page, no band (the
                // reference); landscape: they float over the picture
                if landscape {
                    Rectangle()
                        .fill(.ultraThinMaterial)
                        .opacity(0.92)
                        .ignoresSafeArea()
                }
            }
    }
}
