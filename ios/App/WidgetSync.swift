// The home-screen widgets' data path: the app's own updates, published.
//
// A widget extension is a separate process on a system budget, so it cannot
// subscribe to the session. Instead the app freezes the same `updates` the
// pill reads into the App Group whenever they change — the same 400 ms
// debounce the Dynamic Island rides — and tells WidgetKit to reload only
// when the payload actually differs. While the app is alive the widgets are
// exact; once it is gone they age the last snapshot and say so.
import Combine
import CompanionCore
import Foundation
import WidgetKit

@MainActor
final class WidgetSyncBridge {
    private let store: WidgetSnapshotStore?
    private var cancellable: AnyCancellable?
    /// The last snapshot this bridge wrote; an equal payload is neither
    /// rewritten nor allowed to cost the widget a reload.
    private var lastWritten: WidgetSnapshot?
    /// The per-chat elapsed clock, seeded from the last snapshot so work
    /// that began before this launch keeps its true start.
    private var sinceClock = WidgetSinceClock()
    /// Whether the unpaired state is already what is on disk. Starts false —
    /// at launch nothing is known about the file — so an app that comes up
    /// unpaired still clears whatever the last session left behind, once.
    private var publishedUnpaired = false

    init(store: WidgetSnapshotStore?) {
        self.store = store
        sinceClock = WidgetSinceClock(seed: store?.read())
    }

    /// The bridge over the App Group container the widget extension reads.
    /// A nil store when the group is unavailable (unsigned previews) makes
    /// the whole bridge a no-op rather than a crash in a development build.
    static func makeAppGroupBridge() -> WidgetSyncBridge {
        let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: SagaxSharedConfiguration.appGroupIdentifier
        )
        return WidgetSyncBridge(store: container.map { WidgetSnapshotStore(directory: $0) })
    }

    /// The session, for its transcript memo: a chat's mood reads the last
    /// visible line, which the memo keeps instead of walking each thread.
    private weak var session: Session?

    func attach(to session: Session) {
        self.session = session
        // Both the fleet and the connection matter: an unpaired app must
        // clear the snapshot even when no state change would have said so.
        cancellable = Publishers.CombineLatest3(session.statePublisher, session.$connection, session.$isDemo)
            .debounce(for: .milliseconds(400), scheduler: DispatchQueue.main)
            .sink { [weak self] state, connection, isDemo in
                // The demo never reaches the widgets: they show "not paired".
                self?.sync(isDemo ? CompanionState() : state, connectionID: isDemo ? nil : connection?.id, memo: !isDemo)
            }
    }

    /// The last write before suspension. The debounced stream may never
    /// fire for the newest state, and a snapshot one ask behind is the
    /// difference between answering from the home screen and opening a
    /// chat that has already moved on.
    func flush(_ state: CompanionState, connectionID: String?) {
        // Let every queued write land first: the guard below then compares
        // with what is really on disk, and nothing older lands after this.
        writeQueue.sync {}
        sync(state, connectionID: connectionID, inBackground: false)
    }

    /// The snapshot's JSON encode and file write leave the main thread
    /// (#3017, L21); the suspension flush stays synchronous. Every disk
    /// operation, the removal on unpairing included, goes through this one
    /// serial queue, so they land in the order they were asked for.
    private let writeQueue = DispatchQueue(label: "sagax.widget-sync.write", qos: .utility)

    private func sync(_ state: CompanionState, connectionID: String?, inBackground: Bool = true, memo: Bool = false) {
        guard let store else { return }
        guard let connectionID else {
            // Unpaired: no snapshot at all beats a stale one claiming a
            // connection that no longer exists — the widgets fall back to
            // their pairing placeholder.
            guard !publishedUnpaired else { return }
            // after any paired snapshot still queued, never before it
            writeQueue.async {
                store.remove()
                WidgetCenter.shared.reloadAllTimelines()
            }
            if !inBackground { writeQueue.sync {} }
            lastWritten = nil
            // The clock dies with the session it measured: a re-paired
            // computer's work starts when it starts, not when the last
            // one did.
            sinceClock = WidgetSinceClock()
            publishedUnpaired = true
            return
        }
        publishedUnpaired = false
        let session = memo ? self.session : nil
        let snapshot = state.widgetSnapshot(connectionID: connectionID) { chat in
            if let session { return MausState.forChat(chat, in: session).rawValue }
            return MausState.forChat(chat, in: state).rawValue
        } since: { update in
            sinceClock.stamp(for: update.chat, kind: update.kind)
        }
        sinceClock.forget(absentFrom: state.widgetUpdates.map(\.chat))
        guard snapshot != lastWritten else { return }
        if inBackground {
            lastWritten = snapshot
            writeQueue.async { [weak self] in
                do {
                    try store.write(snapshot)
                    WidgetCenter.shared.reloadAllTimelines()
                } catch {
                    // a failed write is retried on the next change, unless a
                    // newer snapshot has been asked for since
                    Task { @MainActor in
                        if self?.lastWritten == snapshot { self?.lastWritten = nil }
                    }
                }
            }
            return
        }
        do {
            try store.write(snapshot)
            lastWritten = snapshot
            WidgetCenter.shared.reloadAllTimelines()
        } catch {
            // A failed write — an unsigned preview, a full container — must
            // not take the app down with it; the widget keeps whatever
            // the previous write left.
        }
    }
}
