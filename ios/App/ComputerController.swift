// The computer viewer's state and wire traffic (parity 13 and 11).
//
// Control is a lease: taking it (POST .../computer/control take) stops the
// bot's own hands until it is released, here or when the view goes away.
// While held, input is queued, merged and sent at most one batch at a time
// on a ~60 Hz tick (CompanionCore `ComputerInputBatcher`), and the picture
// is refreshed with direct captures on top of the event stream's frames.
import CompanionCore
import SwiftUI
import UIKit

@MainActor
final class ComputerController: ObservableObject {
    enum ControlPhase: Equatable { case idle, taking, held, releasing }

    enum Prompt: Identifiable, Equatable {
        /// Input was refused: offer to take control.
        case takeControl
        case heldElsewhere
        case message(String)
        var id: String {
            switch self {
            case .takeControl: "take"
            case .heldElsewhere: "elsewhere"
            case let .message(text): "message:\(text)"
            }
        }
    }

    let botId: String
    /// One lease per bot on this phone, kept across launches: if the app is
    /// killed while in control, the next launch takes the same hold back
    /// instead of finding it held by "someone else".
    let leaseId: String

    @Published private(set) var phase: ControlPhase = .idle
    @Published private(set) var image: UIImage?
    @Published private(set) var pointer = RemotePointerEstimate()
    /// True once the person has moved the trackpad: the drawn arrow stays
    /// hidden at the default centre until then (the desktop shows none).
    @Published private(set) var pointerMoved = false
    @Published private(set) var showsToast = false
    @Published private(set) var noComputer = false
    @Published var prompt: Prompt?
    /// A short status line under the frame (an error, a copy done).
    @Published var notice: String?
    @Published private(set) var modifiers: Set<ComputerModifier> = []
    @Published private(set) var refreshing = false

    /// The DEBUG parity harness keeps the toast up for its screenshot.
    var pinsToast = false
    /// The frame's on-screen width, for the pointer gain.
    var frameWidth: CGFloat = 402 {
        didSet { updateGain() }
    }

    private var clientProvider: @MainActor () -> CompanionClient?
    private var translator = TrackpadTranslator()
    private var keyboard = RemoteKeyboardTranslator()
    private var batcher = ComputerInputBatcher()
    private var inFlight = false
    private var flushTask: Task<Void, Never>?
    private var pollTask: Task<Void, Never>?
    private var toastTask: Task<Void, Never>?
    private var visible = false

    init(botId: String, client: @escaping @MainActor () -> CompanionClient?) {
        self.botId = botId
        self.clientProvider = client
        let key = "companion.computer.lease.\(botId)"
        if let saved = UserDefaults.standard.string(forKey: key), saved.count >= 16 {
            leaseId = saved
        } else {
            leaseId = ComputerControlLease.make()
            UserDefaults.standard.set(leaseId, forKey: key)
        }
        updateGain()
    }

    /// The view hands over the session's client once it has it.
    func attach(_ client: @escaping @MainActor () -> CompanionClient?) {
        clientProvider = client
    }

    var isHeld: Bool { phase == .held }

    /// The remote screen in pixels, from the latest picture (1280x800 until one arrives).
    var remoteSize: CGSize {
        guard let image, image.size.width > 0 else { return CGSize(width: 1280, height: 800) }
        return CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
    }

    private func updateGain() {
        translator.accelerator.baseGain = Double(remoteSize.width / max(frameWidth, 1))
    }

    // MARK: Lifecycle

    func appear() {
        visible = true
        if image == nil { Task { await refreshPicture(silently: true) } }
    }

    func disappear() {
        visible = false
        stopLoops()
        pointerMoved = false
        pointer = RemotePointerEstimate()
        if phase == .held || phase == .taking {
            phase = .idle
            let client = clientProvider()
            let botId = botId, leaseId = leaseId
            Task { _ = try? await client?.releaseComputerControl(botId: botId, controlLeaseId: leaseId) }
        }
    }

    /// A frame from the event stream.
    func streamFrame(_ data: Data?) {
        guard let data else { return }
        // Decoded off the main thread; a frame that finishes after a newer
        // one has been asked for is dropped, so frames never go backwards.
        streamFrameSequence += 1
        let sequence = streamFrameSequence
        Task {
            guard let decoded = await ImageDecoding.prepared(data), sequence == streamFrameSequence else { return }
            setImage(decoded)
        }
    }
    private var streamFrameSequence = 0

    private func setImage(_ new: UIImage) {
        image = new
        updateGain()
    }

    // MARK: Control

    func takeControl() async {
        guard phase == .idle else { return }
        guard let client = clientProvider() else { notice = String(localized: "This computer is offline."); return }
        phase = .taking
        do {
            let state = try await client.takeComputerControl(botId: botId, controlLeaseId: leaseId)
            guard state.held else { phase = .idle; notice = String(localized: "Control was not taken."); return }
            phase = .held
            notice = nil
            translator = TrackpadTranslator()
            updateGain()
            batcher.clear()
            // Put the pointer where the indicator starts: the centre.
            enqueue([.moveTo(x: 0.5, y: 0.5)])
            showToast()
            startLoops()
        } catch {
            phase = .idle
            handle(error)
        }
    }

    func releaseControl() async {
        guard phase == .held else { return }
        phase = .releasing
        stopLoops()
        batcher.clear()
        if translator.dragging { _ = translator.events(for: .dragEnded) }
        modifiers = []
        keyboard = RemoteKeyboardTranslator()
        do {
            _ = try await clientProvider()?.releaseComputerControl(botId: botId, controlLeaseId: leaseId)
        } catch {
            handle(error)
        }
        phase = .idle
    }

    private func showToast() {
        toastTask?.cancel()
        withAnimation(.easeOut(duration: 0.25)) { showsToast = true }
        guard !pinsToast else { return }
        toastTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.easeIn(duration: 0.4)) { self?.showsToast = false }
        }
    }

    // MARK: Input

    func handle(_ gesture: TrackpadGesture) {
        guard phase == .held else {
            if gesture == .tap || gesture == .twoFingerTap { prompt = .takeControl }
            return
        }
        enqueue(translator.events(for: gesture))
    }

    func type(_ text: String) {
        guard phase == .held else { return }
        enqueue(keyboard.insert(text))
        modifiers = keyboard.modifiers
    }

    func deleteBackward() {
        guard phase == .held else { return }
        enqueue(keyboard.deleteBackward())
        modifiers = keyboard.modifiers
    }

    func special(_ key: RemoteSpecialKey) {
        guard phase == .held else { return }
        enqueue(keyboard.special(key))
        modifiers = keyboard.modifiers
    }

    func toggle(_ modifier: ComputerModifier) {
        keyboard.toggle(modifier)
        modifiers = keyboard.modifiers
    }

    private func enqueue(_ events: [ComputerInputEvent]) {
        guard !events.isEmpty else { return }
        batcher.append(contentsOf: events)
        let size = remoteSize
        pointer.apply(events, width: Double(size.width), height: Double(size.height))
        if !pointerMoved, events.contains(where: {
            if case .move = $0 { return true }
            if case .moveTo = $0 { return true }
            return false
        }) {
            pointerMoved = true
        }
    }

    private func startLoops() {
        flushTask?.cancel()
        flushTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.flushIfReady()
                try? await Task.sleep(nanoseconds: 16_666_667)
            }
        }
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            var failures = 0
            while !Task.isCancelled {
                guard let self else { return }
                let ok = await self.refreshPicture(silently: true)
                failures = ok ? 0 : failures + 1
                // Faster while in control; back off from a computer that
                // cannot capture (the stream still brings frames).
                if failures >= 3 { return }
                try? await Task.sleep(nanoseconds: ok ? 500_000_000 : 4_000_000_000)
            }
        }
    }

    private func stopLoops() {
        flushTask?.cancel()
        flushTask = nil
        pollTask?.cancel()
        pollTask = nil
        toastTask?.cancel()
        showsToast = false
    }

    private func flushIfReady() async {
        guard phase == .held, !inFlight, !batcher.isEmpty, let client = clientProvider() else { return }
        let batch = batcher.drain()
        inFlight = true
        defer { inFlight = false }
        do {
            try await client.computerInput(botId: botId, events: batch, controlLeaseId: leaseId)
        } catch {
            batcher.clear()
            handle(error)
        }
    }

    // MARK: Clipboard

    /// The phone's clipboard to the computer's.
    func sendClipboard() async {
        guard let client = clientProvider() else { notice = String(localized: "This computer is offline."); return }
        let text = UIPasteboard.general.string ?? ""
        guard !text.isEmpty else { notice = String(localized: "The clipboard has no text."); return }
        do {
            try await client.setComputerClipboard(botId: botId, text: text, controlLeaseId: leaseId)
            notice = String(localized: "Clipboard sent to the computer.")
        } catch {
            handle(error)
        }
    }

    /// The computer's clipboard to the phone's.
    func copyComputerClipboard() async {
        guard let client = clientProvider() else { notice = String(localized: "This computer is offline."); return }
        do {
            let text = try await client.computerClipboard(botId: botId, controlLeaseId: leaseId)
            UIPasteboard.general.string = text
            notice = text.isEmpty ? String(localized: "The computer's clipboard is empty.") : String(localized: "Copied the computer's clipboard.")
        } catch {
            handle(error)
        }
    }

    // MARK: Picture

    /// A direct capture. Silent failures leave the stream's frames in charge.
    @discardableResult
    func refreshPicture(silently: Bool) async -> Bool {
        guard let client = clientProvider() else { return false }
        if !silently { refreshing = true }
        defer { if !silently { refreshing = false } }
        do {
            let shot = try await client.computerScreenshot(botId: botId)
            if let data = shot.data, let decoded = await ImageDecoding.prepared(data) { setImage(decoded) }
            return true
        } catch {
            if !silently { notice = String(localized: "Could not refresh the picture: \(error.localizedDescription)") }
            return false
        }
    }

    // MARK: Errors

    private func handle(_ error: Error) {
        switch error as? ComputerError {
        case .noControl?:
            if phase == .held { stopLoops() }
            phase = .idle
            prompt = .takeControl
        case .controlHeldElsewhere?:
            if phase == .held { stopLoops() }
            phase = .idle
            prompt = .heldElsewhere
        case .noComputer?:
            if phase == .held { stopLoops() }
            phase = .idle
            noComputer = true
            notice = ComputerError.noComputer.errorDescription.map(AppStrings.localized)
        case let .offline(detail)?:
            notice = detail
        case let other?:
            notice = other.errorDescription.map(AppStrings.localized)
        case nil:
            notice = error.localizedDescription
        }
    }

    deinit {
        flushTask?.cancel()
        pollTask?.cancel()
        toastTask?.cancel()
    }
}
