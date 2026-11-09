// A live call with a bot or a room, as on the desktop's voice mode
// (src/components/voice-mode/LiveCall.tsx, GroupCallView.tsx): a phone call.
// The microphone stays open, the person can talk over the bot, and the bot's
// answer is spoken sentence by sentence while it is written.
//
// The BOT answers: every accepted turn is an ordinary message through the
// normal send route (its engine, instructions, memory, tools, approvals, and
// the transcript in the thread), marked as a call turn (`voiceCall`) so the
// server gives it the hidden phone-call instruction. The phone only hears
// (on-device recognition) and reads the bot's own words aloud with the voice
// the desktop would use for that bot.
//
// LiveCallEngine (CompanionCore) decides; CallConversation decides what to
// say about the thread; this object runs the devices (CallAudioIO, the
// recognizer, the player, CallKit) and talks to the Session.
import AVFoundation
import Combine
import CompanionCore
import SwiftUI

/// How long one voice call ran. The transcript card reads it. A relaunch
/// has none, and the card falls back to the first and last spoken lines.
struct CallClockRecord: Equatable {
    var startedAt: Date
    var endedAt: Date?
}

@MainActor
final class CallController: ObservableObject {
    static let shared = CallController()

    /// A call that could not start: the server's access card (voice mode on
    /// an organization server), or why there is no call here.
    struct Unavailable: Identifiable, Equatable {
        let id = UUID()
        let title: String
        let lines: [String]
        let keysUrl: URL?
    }

    @Published private(set) var target: Chat?
    @Published private(set) var state = CallState.initial
    /// The words recognized so far in the person's turn.
    @Published private(set) var heard = ""
    /// The bot's sentence now audible.
    @Published private(set) var caption = ""
    @Published private(set) var note: String?
    @Published private(set) var notice: String?
    @Published private(set) var startedAt = Date()
    @Published private(set) var interrupted: Set<String> = []
    /// The cut answers' words the person never heard, by reply id.
    @Published private(set) var unheard: [String: String] = [:]
    /// A room: the member whose voice is audible.
    @Published private(set) var speakingMemberId: String?
    @Published var unavailable: Unavailable?
    @Published private(set) var voiceModeAvailable = false
    @Published private(set) var voices: [VoiceModeVoice]?
    @Published private(set) var voicesError: String?
    @Published private(set) var previewing: String?
    @Published private(set) var recognizerName = ""
    /// Who hears and speaks on this call (xAI with whose key, or Apple on
    /// this phone when no voice provider is set up), shown on the call.
    @Published private(set) var provider: CallProvider = .apple
    /// The key the voice runs on (the status's), for the provider line.
    @Published private(set) var voiceKey: VoiceKeyInfo?
    /// Why this call is on Apple's ears and voice although the person
    /// would have xAI: the server could not be asked (its error), or no key
    /// serves them (the refusal's line). Nil when Apple is the plain choice.
    @Published private(set) var appleReason: String?
    /// The provider line the call shows.
    var providerLabel: String {
        switch provider {
        case let .xai(via): VoiceWords.providerLine(key: voiceKey, via: via)
        case .apple where appleReason != nil: String(localized: "Voice: Apple on this iPhone (xAI could not be used)")
        case .apple: String(localized: "Voice: Apple on this iPhone (no voice provider set up)")
        }
    }
    /// The notice a voice failure put up: cleared once the voice is heard again.
    private var voiceNotice: String?
    /// The key fallback already said on this call (said once).
    private var keyFallbackSaid: String?

    @Published var voiceSettings: VoiceModeSettings {
        didSet {
            guard voiceSettings != oldValue else { return }
            UserDefaults.standard.set(voiceSettings.encoded, forKey: VoiceModeSettings.storageKey)
            syncVoiceSettings()
        }
    }

    @Published var callSettings: CallSettings {
        didSet { UserDefaults.standard.set(callSettings.encoded, forKey: CallSettings.storageKey) }
    }

    /// "Only my voice": where the enrollment stands on this phone.
    @Published private(set) var enrollment: CallEnrollment = CallVoiceprint.read() == nil ? .none : .enrolled

    private(set) var threadId = ""
    private weak var session: Session?
    private var engine: LiveCallEngine?
    private var io: CallAudioIO?
    private var player: CallSpeechPlayer?
    private var recognizer: CallRecognizer?
    private var callKit: CallKitBridge?
    private var conversation = CallConversation(existing: [])
    private var stateSink: AnyCancellable?
    private var observers: [NSObjectProtocol] = []
    @Published private(set) var callClocks: [String: CallClockRecord] = [:]
    private(set) var callId = ""
    private var devicesStarted = false
    private var lastBusy: Bool?
    private var members: [Bot] = []
    private var organization = false
    private var previewVoice: String?
    private var callAlive: Timer?
    /// asks the conversation for a progress line while the bot works in silence
    private var progressTick: Timer?
    /// the thread as last observed (the progress tick reads it)
    private var lastMessages: [Message] = []
    private var callEnd: (() -> Void)?
    /// Kept for the life of the controller. `end()` clears `observers`, so
    /// the server's hang-up must not live in that list.
    private var serverHangupObserver: NSObjectProtocol?
    private var serverHangup: Task<Void, Never>?
    /// A system interruption (a phone call, Siri, an alarm) ended without
    /// `.shouldResume`: the call stays on hold until the app is active again
    /// or the person taps Resume.
    private var interruptionPending = false
    /// The demo's language ("en" or "fr") while a demo call runs: with the
    /// call language on Auto, the demo's French replies are heard and read
    /// in French even when the system language is not.
    private var demoLanguage: String?

    /// The voice settings this call uses.
    private var callVoiceSettings: VoiceModeSettings {
        var settings = voiceSettings
        if let demoLanguage, settings.language == "auto" { settings.language = demoLanguage }
        return settings
    }

    private init() {
        voiceSettings = VoiceModeSettings.decode(UserDefaults.standard.string(forKey: VoiceModeSettings.storageKey))
        callSettings = CallSettings.decode(UserDefaults.standard.string(forKey: CallSettings.storageKey))
        serverHangupObserver = NotificationCenter.default.addObserver(
            forName: .sagaxVoiceCallEnded, object: nil, queue: .main
        ) { [weak self] note in
            let threadId = note.userInfo?["threadId"] as? String ?? ""
            let callId = note.userInfo?["callId"] as? String ?? ""
            Task { @MainActor in
                self?.hangUpFromServer(threadId: threadId, callId: callId)
            }
        }
    }

    var active: Bool { target != nil }

    func isOnCall(_ chat: Chat) -> Bool { target?.id == chat.id }

    var levels: (mic: Float, bot: Float) { (io?.micLevel ?? 0, io?.outputLevel ?? 0) }

    private var injecting: Bool {
        #if DEBUG
        CallDebug.injecting
        #else
        false
        #endif
    }

    // MARK: - Starting and ending

    /// Call this chat (the composer's call button). A second call ends the first.
    func start(_ chat: Chat, session: Session) async {
        if isOnCall(chat) { return }
        if active { end() }
        guard let client = session.callClient else {
            unavailable = Unavailable(title: String(localized: "Call unavailable"), lines: [String(localized: "This computer is offline.")], keysUrl: nil)
            return
        }
        self.session = session
        let isRoom: Bool
        if case .room = chat { isRoom = true } else { isRoom = false }
        // The demo's call stays on this phone: recognition on device (or
        // typed lines), the demo's prepared replies, the phone's own voice.
        // No voice mode, no voice provider, no CallKit, no call session.
        let demo = session.isDemo
        demoLanguage = demo ? DemoLaunch.language.rawValue : nil

        // the server decides, every time (desktop VoiceModeCallButton):
        // asked twice, and a server that cannot answer is said, never a
        // silent fall to Apple's ears (2026-10-28)
        var status: VoiceModeStatus?
        var statusError: String?
        if !demo, case let .bot(bot) = chat { (status, statusError) = await Self.askVoiceStatus(client, botId: bot.id) }
        organization = status?.organization == true
        if case let .bot(bot) = chat, status?.organization == true, status?.available != true {
            unavailable = Self.refusal(status?.refusal, botName: bot.name)
            return
        }
        voiceKey = status?.key
        appleReason = nil
        if !demo, !isRoom, status?.available != true {
            if let statusError {
                appleReason = String(localized: "The server could not say whether xAI voice is available (\(statusError)).")
            } else if let refusal = status?.refusal {
                appleReason = VoiceWords.refusalLines(cause: refusal.cause, admin: refusal.admin == true).joined(separator: " ")
            }
        }
        if !demo, isRoom, session.connection?.pairedWithServer == true, await roomOnOrganization(session: session, client: client) {
            unavailable = Unavailable(
                title: String(localized: "Voice mode unavailable"),
                lines: [String(localized: "On an organization server, voice mode talks with one bot at a time: open a bot's conversation to call it.")],
                keysUrl: nil
            )
            return
        }
        voiceModeAvailable = status?.available == true
        provider = CallProvider.choose(voiceMode: status, room: isRoom, demo: demo)
        let config = demo ? nil : await session.configStatus()
        if organization { await seedVoiceSettings(client) }

        target = chat
        threadId = chat.threadId
        CallQuiet.shared.set(threadId, live: true)
        state = .initial
        heard = ""
        caption = ""
        note = nil
        notice = nil
        interrupted = []
        unheard = [:]
        speakingMemberId = nil
        voices = nil
        voicesError = nil
        startedAt = Date()
        callId = "call-" + UUID().uuidString.lowercased()
        // Apple's ears and voice although xAI was wanted: said at the start
        if let appleReason { notice = String(localized: "\(appleReason) This call hears and speaks with Apple on this iPhone.") }
        noteCallClockRunning()
        devicesStarted = false
        lastBusy = nil
        members = []
        if case let .room(room) = chat { members = room.memberIds.compactMap { session.state.bot($0) } }
        conversation = CallConversation(existing: session.visibleTranscript(forThread: threadId), room: isRoom)
        #if DEBUG
        if injecting { CallDebug.shared.reset() }
        #endif

        // the ears
        let recognizer = CallRecognizer()
        recognizer.onPartial = { [weak self] text in
            self?.heard = text
            // the words so far move the endpoint: an unfinished clause waits longer
            self?.engine?.partial(text)
        }
        #if DEBUG
        if injecting { recognizer.useScript { CallDebug.shared.currentScript } }
        #endif
        if !injecting {
            guard await MicrophonePermission.request() else {
                var lines = [String(localized: "Allow microphone access for Sagax in Settings, then try again.")]
                if demo { lines.append(String(localized: "You can still type to \(chat.name) in the demo.")) }
                unavailable = Unavailable(title: String(localized: "Call unavailable"), lines: lines, keysUrl: nil)
                CallQuiet.shared.set(threadId, live: false)
                noteCallClockEnded()
                target = nil
                return
            }
            let upload: (([Float]) async throws -> String)? = voiceModeAvailable && !isRoom ? { [weak self] samples in
                guard let self, case let .bot(bot)? = self.target else { return "" }
                let heard = try await client.voiceModeTranscription(botId: bot.id, wav: CallWav.encode(samples), language: self.voiceSettings.language, threadId: self.threadId)
                self.noteKeyOutcome(heard.key)
                return heard.text
            } : nil
            recognizer.onUploadFailed = { [weak self] error in
            guard let self, self.target != nil else { return }
            // the reason and the key it is about (VoiceWords), never a
            // silent "did not get through" when the server said why
            if let failure = error as? VoiceFailure {
                self.notice = VoiceWords.line(failure)
                self.voiceNotice = self.notice
            } else {
                self.notice = String(localized: "That did not get through. Could you say it again?")
            }
            Task { await self.engine?.say(String(localized: "That did not get through. Could you say it again?")) }
        }
        let ready = await recognizer.prepare(locales: callVoiceSettings.recognitionLocales(), upload: upload, onDeviceOnly: demo, preferServer: provider.recognizesOnServer)
            guard target?.id == chat.id else { return }
            if !ready, demo, !recognizer.speechAuthorized {
                note = String(localized: "Allow Speech Recognition for Sagax in Settings to talk. Meanwhile, type your message: \(chat.name) answers out loud.")
            } else if !ready, demo {
                note = String(localized: "This phone can't recognize speech offline in this language. Type your message: \(chat.name) answers out loud.")
            } else if !ready {
                note = String(localized: "Speech recognition isn't available for this language. Allow Speech Recognition in Settings, then try again.")
            }
        }
        recognizerName = recognizer.engine.rawValue

        // the voice
        let io = CallAudioIO()
        let botVoice: String? = if case let .bot(bot) = chat { bot.voice } else { nil }
        let route: (CallSpeaker?) -> [CallVoiceSource] = { speaker in
            // the demo speaks with the phone's voice only: nothing to fetch
            if demo { return [.device] }
            return CallVoiceSource.route(
                voiceMode: isRoom ? nil : status,
                config: config,
                agentVoice: speaker?.voice ?? botVoice,
                phoneKey: WalkieVoiceKey.read() != nil
            )
        }
        let source: CallSpeechSourcing
        #if DEBUG
        if CallDebug.capturingSpeech {
            source = CapturedSpeechSource(route: route)
        } else {
            source = routedSource(client: client, chat: chat, route: route)
        }
        #else
        source = routedSource(client: client, chat: chat, route: route)
        #endif
        let player = CallSpeechPlayer(io: io, source: source)
        if case let .bot(bot) = chat { player.speaker = CallSpeaker(id: bot.id, name: bot.name, voice: bot.voice) }

        let engine = LiveCallEngine(
            transcriber: recognizer,
            player: player,
            settings: { [weak self] in self?.callSettings ?? .default },
            speed: { [weak self] in self?.voiceSettings.speed ?? 1 },
            voiceprint: CallVoiceprint.read()
        )
        wire(engine)
        player.onSentenceStart = { [weak self, weak engine] text, speaker in
            engine?.playerSentenceStarted(text)
            if isRoom { self?.speakingMemberId = speaker?.id }
        }
        player.onIdle = { [weak self, weak engine] in
            engine?.playerIdle()
            self?.speakingMemberId = nil
        }
        player.onError = { [weak self] error in
            guard let self else { return }
            // the server's reason when it gave one, and the key it is about
            // (xAI has no credits left for your voice key ···Wez8...)
            if let failure = error as? VoiceFailure {
                self.notice = VoiceWords.line(failure)
            } else if case let APIError.status(_, message) = error, let message, !message.isEmpty {
                self.notice = message
            } else {
                self.notice = String(localized: "The voice didn't come through. The answer is in the chat.")
            }
            self.voiceNotice = self.notice
        }
        // the voice is heard again: a voice failure line is over
        let started = player.onSentenceStart
        player.onSentenceStart = { [weak self] text, speaker in
            started(text, speaker)
            guard let self, let shown = self.voiceNotice else { return }
            if self.notice == shown { self.notice = nil }
            self.voiceNotice = nil
        }
        io.onFrame = { [weak engine] frame in engine?.frame(frame) }
        self.io = io
        self.player = player
        self.engine = engine
        self.recognizer = recognizer
        VoiceNoteCenter.shared.beginInputOwnership(.call)
        observeAudioSession()

        // the call only needs the thread's latest words and busy flag: take
        // the newest state at most ten times a second instead of rebuilding
        // the transcript on every frame (#3017, L13)
        stateSink = session.statePublisher
            .throttle(for: .milliseconds(100), scheduler: DispatchQueue.main, latest: true)
            .sink { [weak self] state in self?.observe(state) }

        // the server knows the thread is on a call: every send to it while
        // the call lasts is a call turn (typed words, a queued line, a retry)
        if case let .bot(bot) = chat {
            let call = (callId: callId, threadId: threadId, language: voiceSettings.language)
            // the reply carries the words to expect (names, the thread's proper
            // nouns): recognition starts now and uses them from the next turn
            if !demo {
                Task { [weak self, weak recognizer] in
                    guard let terms = await client.voiceCallStart(botId: bot.id, callId: call.callId, threadId: call.threadId, language: call.language),
                          !terms.isEmpty, self?.recognizer === recognizer else { return }
                    recognizer?.useContextualStrings(terms)
                }
            }
            progressTick?.invalidate()
            progressTick = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
                DispatchQueue.main.async { self?.tickProgress() }
            }
        }
        if !demo, case let .bot(bot) = chat {
            let call = (callId: callId, threadId: threadId, language: voiceSettings.language)
            callAlive = Timer.scheduledTimer(withTimeInterval: 5 * 60, repeats: true) { _ in
                Task { await client.voiceCallSession(botId: bot.id, state: .alive, callId: call.callId, threadId: call.threadId, language: call.language) }
            }
            callEnd = { Task { await client.voiceCallSession(botId: bot.id, state: .end, callId: call.callId, threadId: call.threadId, language: call.language) } }
        }

        // the call itself: CallKit, or the audio session directly
        let bridge = CallKitBridge()
        bridge.onActivate = { [weak self] in self?.activateDevices() }
        bridge.onEnd = { [weak self] in self?.end(fromSystem: true) }
        bridge.onMute = { [weak self] muted in self?.engine?.setMuted(muted) }
        bridge.onHold = { [weak self] held in held ? self?.engine?.hold() : self?.engine?.resume() }
        callKit = bridge
        let handle: String = switch chat {
        case let .bot(bot): CarCallHandle.value(kind: .bot, id: bot.id)
        case let .room(room): CarCallHandle.value(kind: .room, id: room.id)
        }
        let placed = injecting || demo ? false : await bridge.start(name: chat.name, handle: handle)
        // Siri ("call Scout with Sagax", a reply to an announced message):
        // asked once, after the person chose to call a bot
        if !demo { SiriAccess.askOnce() }
        guard target?.id == chat.id else { return }
        if placed {
            // the system activates the session for the call; if it never says
            // so (a busy route), start anyway
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
                guard let self, self.target?.id == chat.id, !self.devicesStarted else { return }
                try? AVAudioSession.sharedInstance().setActive(true)
                self.activateDevices()
            }
        } else {
            callKit = nil
            if !injecting {
                do {
                    try CallAudioIO.configureSession()
                    try AVAudioSession.sharedInstance().setActive(true)
                } catch {
                    note = String(localized: "No microphone could be opened. Check that one is connected and not in use.")
                }
            }
            activateDevices()
        }
    }

    private func routedSource(client: CompanionClient, chat: Chat, route: @escaping (CallSpeaker?) -> [CallVoiceSource]) -> CallSpeechSourcing {
        let botId: String? = if case let .bot(bot) = chat { bot.id } else { nil }
        let routed = RoutedSpeechSource(
            client: client,
            botId: botId,
            threadId: { [weak self] in self?.threadId },
            routes: route,
            settings: { [weak self] in
                guard let self else { return .default }
                // the voice of this bot's provider (the person's choice for it)
                var settings = self.callVoiceSettings.forBot(botId)
                if let preview = self.previewVoice { settings.voice = preview }
                return settings
            }
        )
        // a voice that failed says why (xAI refused the key, no credits,
        // busy) and about which key: VoiceWords, never a secret
        routed.onFailure = { [weak self] error in
            guard let self, self.target != nil else { return }
            if let failure = error as? VoiceFailure {
                self.notice = VoiceWords.line(failure)
                self.voiceNotice = self.notice
            } else if case let APIError.status(_, message) = error, let message, !message.isEmpty {
                self.notice = message
                self.voiceNotice = message
            }
        }
        // the voice went on over another key: said once, never a silent switch
        routed.onKeyOutcome = { [weak self] outcome in self?.noteKeyOutcome(outcome) }
        return routed
    }

    private func activateDevices() {
        guard let io, let engine, !devicesStarted, target != nil else { return }
        devicesStarted = true
        do {
            // a test call (recordings in, voice captured) renders offline:
            // it never waits on the audio server
            try io.start(capture: !injecting, offline: injecting)
        } catch {
            note = String(localized: "No microphone could be opened. Check that one is connected and not in use.")
            engine.failed()
            return
        }
        engine.connected()
        callKit?.connected()
        #if DEBUG
        if injecting { CallDebug.shared.startFeeding(io) }
        #endif
        if let session { observe(session.state) }
    }

    private func noteCallClockRunning() {
        guard !callId.isEmpty else { return }
        var next = callClocks
        next[callId] = CallClockRecord(startedAt: startedAt, endedAt: nil)
        callClocks = next
    }

    private func noteCallClockEnded() {
        guard !callId.isEmpty, var clock = callClocks[callId], clock.endedAt == nil else { return }
        clock.endedAt = Date()
        var next = callClocks
        next[callId] = clock
        callClocks = next
    }

    /// Hang up (the red X, CallKit's end button, or another call).
    func end(fromSystem: Bool = false) {
        guard target != nil else { return }
        serverHangup?.cancel()
        serverHangup = nil
        noteCallClockEnded()
        CallQuiet.shared.set(threadId, live: false)
        callAlive?.invalidate()
        progressTick?.invalidate()
        progressTick = nil
        callAlive = nil
        callEnd?()
        callEnd = nil
        engine?.end()
        if case .recording = enrollment { enrollment = CallVoiceprint.read() == nil ? .none : .enrolled }
        if !fromSystem { callKit?.end() }
        callKit = nil
        stateSink = nil
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers = []
        interruptionPending = false
        #if DEBUG
        CallDebug.shared.stopFeeding()
        #endif
        let io = self.io
        let wasCallKit = fromSystem
        let injected = injecting
        // the end tone first
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
            io?.stop()
            if !wasCallKit, !injected { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
            VoiceNoteCenter.shared.endInputOwnership(.call)
        }
        engine = nil
        player = nil
        recognizer = nil
        self.io = nil
        target = nil
        state = CallState(phase: .ended)
        heard = ""
        caption = ""
        speakingMemberId = nil
    }

    // MARK: - Controls

    func setMuted(_ muted: Bool) {
        engine?.setMuted(muted)
        callKit?.setMuted(muted)
    }

    func hold() {
        engine?.hold()
        callKit?.setHeld(true)
    }

    func resume() {
        if interruptionPending {
            resumeAfterInterruption()
            return
        }
        engine?.resume()
        callKit?.setHeld(false)
    }

    /// Back from a system interruption: the session active again, the audio
    /// engine restarted, the call off hold.
    private func resumeAfterInterruption() {
        guard target != nil else { return }
        do {
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            // still taken by the other audio: the person taps Resume later
            interruptionPending = true
            notice = String(localized: "The call was interrupted. Tap Resume the call to continue.")
            return
        }
        interruptionPending = false
        notice = nil
        io?.restart()
        engine?.resume()
        callKit?.setHeld(false)
    }

    /// The media services restarted (rare: the audio server crashed). Every
    /// audio object is stale: the session is configured again and the
    /// engine rebuilt on it; the call goes on.
    private func rebuildAfterMediaReset() {
        guard target != nil, let io, !injecting else { return }
        try? CallAudioIO.configureSession()
        try? AVAudioSession.sharedInstance().setActive(true)
        do {
            // the old engine and nodes are invalid after a reset: new ones
            try io.rebuild(capture: true)
        } catch {
            notice = String(localized: "No microphone could be opened. Check that one is connected and not in use.")
            engine?.hold()
            interruptionPending = true
        }
    }

    /// The avatar while the bot speaks: it stops talking.
    func interrupt() { engine?.interrupt() }

    /// "Record my voice": a few seconds of the person's speech on this call
    /// become the print "Only my voice" checks turns against. It stays on
    /// this phone. Turning the switch on without a print starts this too.
    func enroll() {
        guard let engine, active else { return }
        if case .recording = enrollment { return }
        enrollment = .recording(share: 0)
        Task { @MainActor [weak self, weak engine] in
            guard let engine else { return }
            let print = await engine.enroll { share in
                guard let self, case .recording = self.enrollment else { return }
                self.enrollment = .recording(share: share)
            }
            // the call ended while recording: end() already settled it
            guard let self, case .recording = self.enrollment else { return }
            if let print {
                print.save()
                self.enrollment = .enrolled
                self.callSettings.onlyMyVoice = true
            } else {
                self.enrollment = CallVoiceprint.read() == nil ? .failed : .enrolled
            }
        }
    }

    /// "Forget my voice": the print is deleted from this phone.
    func forgetVoice() {
        engine?.forgetVoice()
        CallVoiceprint.forget()
        enrollment = .none
    }

    func pushToTalk(_ down: Bool) { engine?.pushToTalk(down) }

    func retry() {
        note = nil
        guard let io, !io.running else { return }
        devicesStarted = false
        activateDevices()
    }

    func dismissNotice() {
        notice = nil
        note = nil
    }

    /// The voices of the provider this bot speaks with, for the settings'
    /// Voice list.
    func loadVoices() {
        guard voices == nil, voiceModeAvailable, case let .bot(bot)? = target, let client = session?.callClient else { return }
        Task {
            do { voices = try await client.voiceModeVoices(botId: bot.id, provider: voiceSettings.ttsChoice(botId: bot.id)) }
            catch { voicesError = error.localizedDescription }
        }
    }

    /// Hear a voice before picking it.
    func preview(_ voice: VoiceModeVoice) {
        guard let engine else { return }
        if previewing == voice.id {
            engine.interrupt()
            previewing = nil
            previewVoice = nil
            return
        }
        engine.interrupt()
        previewing = voice.id
        previewVoice = voice.id
        Task {
            await engine.say(String(localized: "Hi, I'm \(voice.label). This is how I sound."))
            if previewing == voice.id { previewing = nil }
            previewVoice = nil
        }
    }

    // MARK: - The engine's events

    private func wire(_ engine: LiveCallEngine) {
        engine.events.state = { [weak self] next in
            self?.state = next
            #if DEBUG
            CallDebug.shared.phaseChanged(next.phase)
            #endif
        }
        engine.events.caption = { [weak self] text in self?.caption = text }
        engine.events.microphone = { [weak self] open in self?.io?.micOpen = open }
        engine.events.rejected = { _ in }
        engine.events.speechCancelled = { [weak self] cut in
            guard let self else { return }
            self.caption = ""
            self.conversation.speechCancelled(currentStream: self.session?.state.streaming[self.threadId], cut: cut)
            #if DEBUG
            CallDebug.shared.count("cancelled")
            #endif
        }
        engine.events.interruptBot = { [weak self] in
            guard let self, let session = self.session, let target = self.target else { return }
            guard self.conversation.mayInterruptBot(busy: self.lastBusy ?? false) else { return }
            #if DEBUG
            CallDebug.shared.count("interruptBot")
            #endif
            let threadId = self.threadId
            // what the stopped turn still streams is never spoken
            self.conversation.botInterrupted(currentStream: session.state.streaming[threadId])
            Task {
                switch target {
                case let .bot(bot): await session.interruptQuietly(botId: bot.id, threadId: threadId)
                case let .room(room): await session.interrupt(room: room)
                }
            }
        }
        engine.events.utterance = { [weak self] turn in self?.utterance(turn) }
    }

    private func utterance(_ turn: CallTurn) {
        let text = turn.text
        guard let session, let target, let engine, let client = session.callClient else { return }
        heard = ""
        notice = nil
        let mentionsOnly: Bool = if case let .room(room) = target { room.defaultResponder.kind == "mentions" } else { false }
        let action = conversation.utterance(text, memberNames: members.map(\.name), mentionsOnly: mentionsOnly)
        let threadId = self.threadId
        switch action {
        case let .decide(requestId, allow):
            resync()
            Task {
                do {
                    _ = try await client.respond(threadId: threadId, requestId: requestId, behavior: allow ? "allow" : "deny", message: allow ? nil : "Denied by the user, on a call.")
                } catch {
                    if let prompt = conversation.decisionFailed(requestId: requestId) { await engine.say(self.words(prompt)) }
                }
            }
        case let .answer(requestId, _, words):
            resync()
            Task { _ = try? await client.respond(threadId: threadId, requestId: requestId, behavior: "answer", message: words) }
        case let .say(prompt):
            resync()
            Task { await engine.say(self.words(prompt)) }
        case .needsName:
            resync()
            let names = members.map(\.name).joined(separator: ", ")
            notice = names.isEmpty ? String(localized: "Say a member's name, or say everyone.") : String(localized: "Say a member's name (\(names)), or say everyone.")
        case let .send(words):
            #if DEBUG
            CallDebug.shared.count("sent")
            #endif
            Task {
                switch target {
                case let .bot(bot):
                    // one id per utterance (also the send's id): the server
                    // delivers it once, whatever retries (desktop LiveCall)
                    let meta = VoiceCallMeta(
                        callId: callId, interrupted: turn.interrupted, language: voiceSettings.language,
                        utteranceId: "utt-" + UUID().uuidString.lowercased(), cut: turn.cut, continues: turn.continues,
                        duplex: callSettings.fullDuplex
                    )
                    var sent = await session.sendCallTurn(words, to: bot, threadId: threadId, voiceCall: meta)
                    if !sent, self.target?.id == target.id {
                        // a blip, or a turn that ended under it: once more, same utterance
                        session.actionError = nil
                        try? await Task.sleep(nanoseconds: 800_000_000)
                        if self.target?.id == target.id {
                            sent = await session.sendCallTurn(words, to: bot, threadId: threadId, voiceCall: meta)
                        }
                    }
                    if !sent, self.target?.id == target.id {
                        session.actionError = nil
                        self.resync()
                        // never left waiting on silence
                        await engine.say(String(localized: "That did not get through. Could you say it again?"))
                    }
                case let .room(room):
                    await session.send(words, to: .room(room))
                    if session.actionError != nil, self.target?.id == target.id {
                        self.note = session.actionError
                        session.actionError = nil
                        self.resync()
                    }
                }
            }
        }
    }

    /// After a turn that started no run, follow the bot's real state again.
    private func resync() {
        engine?.setBotBusy(lastBusy ?? false)
    }

    // MARK: - The thread, as it changes

    private func observe(_ state: CompanionState) {
        guard let target, let engine, let player else { return }
        let messages = state.visibleTranscript(forThread: threadId)
        let busy: Bool
        let name: String
        switch target {
        case let .bot(bot):
            busy = state.bot(bot.id)?.projected(forThread: threadId)?.busy ?? false
            name = bot.name
        case let .room(room):
            let live = state.rooms.first { $0.id == room.id }
            busy = live?.busyBotId != nil
            name = room.name
            members = (live?.memberIds ?? room.memberIds).compactMap { state.bot($0) }
        }
        if busy != lastBusy {
            lastBusy = busy
            engine.setBotBusy(busy)
        }
        engine.setBackgroundWork(CallConversation.hasBackgroundWork(messages))
        if let live = conversation.stream(state.streaming[threadId]) {
            engine.replyProgress(live)
        }
        lastMessages = messages
        let actions = conversation.settle(messages: messages, botName: name, thinking: engine.state.phase == .thinking, playerBusy: player.busy, duplex: callSettings.fullDuplex, botBusy: busy)
        interrupted = conversation.interrupted
        unheard = conversation.unheard
        var restSaid = false
        for action in actions {
            switch action {
            case let .say(prompt, speakerId):
                player.speaker = speaker(speakerId)
                engine.speakNow(words(prompt))
            case let .replyDone(text, speakerId):
                player.speaker = speaker(speakerId)
                engine.replyDoneNow(text)
                // cut at the sentence cap: say once where the rest is
                if !restSaid, SpokenText.spokenAnswer(text).cut == .length, let rest = restInChatWords(messages: messages) {
                    restSaid = true
                    engine.speakNow(rest)
                }
            case let .reply(text, speakerId):
                player.speaker = speaker(speakerId)
                let answer = SpokenText.spokenAnswer(text)
                engine.speakNow(answer.text)
                if !restSaid, answer.cut == .length, let rest = restInChatWords(messages: messages) {
                    restSaid = true
                    engine.speakNow(rest)
                }
            case let .narrate(text, speakerId):
                player.speaker = speaker(speakerId)
                engine.speakNow(text)
            case let .progress(line):
                guard let words = progressWords(line, messages: messages) else { break }
                player.speaker = speaker(nil)
                engine.speakNow(words)
            case let .announce(text, speakerId):
                player.speaker = speaker(speakerId)
                engine.speakNow(text)
            }
        }
    }

    /// A progress line is due once a tool has run a moment with nothing
    /// said, then after a real silence (CallProgress): the thread does not
    /// change then, so a short tick asks.
    private func tickProgress() {
        guard let engine, let player, case .bot? = target else { return }
        // a failed turn is said once, in one sentence, never its cause
        // never over the person: hearing them, or just cut by them
        let personTalking = engine.state.phase == .hearing || engine.state.phase == .interrupted
        if let kind = conversation.failureKind(messages: lastMessages, botBusy: lastBusy ?? false, playerBusy: player.busy || personTalking) {
            player.speaker = speaker(nil)
            engine.speakNow(failureWords(kind, messages: lastMessages))
            return
        }
        guard let line = conversation.progressLine(
            messages: lastMessages, thinking: engine.state.phase == .thinking,
            botBusy: lastBusy ?? false, playerBusy: player.busy
        ) else { return }
        guard let words = progressWords(line, messages: lastMessages) else { return }
        player.speaker = speaker(nil)
        engine.speakNow(words)
    }

    /// The app's words for a progress line (Localizable.xcstrings), in the
    /// call's language like the desktop (CallProgress.language), not the
    /// app's: never the tool's name, its arguments or an identifier. Nil when
    /// the app has no words in that language (silence beats the wrong one).
    func progressWords(_ line: CallProgressLine, messages: [Message]) -> String? {
        let language = CallProgress.language(
            callLanguage: callVoiceSettings.language,
            lastUserText: CallProgress.lastUserText(messages),
            appLanguage: Bundle.main.preferredLocalizations.first ?? "en"
        )
        // English is the strings' source language: its words are the keys
        let isEnglish = language.lowercased() == "en" || language.lowercased().hasPrefix("en-")
        let bundle = Self.wordsBundle(language)
        if bundle == nil && !isEnglish { return nil }
        let locale = Locale(identifier: language)
        // the language's own words, or (English only) the source words
        func words(_ key: String, _ english: @autoclosure () -> String, _ localized: (Bundle) -> String) -> String? {
            if let bundle, Self.hasWords(key, in: bundle) { return localized(bundle) }
            return isEnglish ? english() : nil
        }
        switch line {
        case let .kind(kind):
            switch kind {
            case .check: return words("I'm checking.", "I'm checking.") { String(localized: "I'm checking.", bundle: $0, locale: locale) }
            case .search: return words("I'm looking it up.", "I'm looking it up.") { String(localized: "I'm looking it up.", bundle: $0, locale: locale) }
            case .web: return words("I'm looking online.", "I'm looking online.") { String(localized: "I'm looking online.", bundle: $0, locale: locale) }
            case .command: return words("I'm running it now.", "I'm running it now.") { String(localized: "I'm running it now.", bundle: $0, locale: locale) }
            case .change: return words("I'm making the change.", "I'm making the change.") { String(localized: "I'm making the change.", bundle: $0, locale: locale) }
            case .screen: return words("I'm looking at the screen.", "I'm looking at the screen.") { String(localized: "I'm looking at the screen.", bundle: $0, locale: locale) }
            case .teammate: return words("I'm asking a teammate.", "I'm asking a teammate.") { String(localized: "I'm asking a teammate.", bundle: $0, locale: locale) }
            case .work: return words("I'm on it.", "I'm on it.") { String(localized: "I'm on it.", bundle: $0, locale: locale) }
            }
        case .still:
            return words("Still on it.", "Still on it.") { String(localized: "Still on it.", bundle: $0, locale: locale) }
        case let .steps(count):
            return words("%lld steps done, I'm still going.", count == 1 ? "1 step done, I'm still going." : "\(count) steps done, I'm still going.") {
                String(localized: "\(count) steps done, I'm still going.", bundle: $0, locale: locale)
            }
        }
    }

    /// "The rest is written in the chat." in the call's language (the same
    /// choice as the progress lines); nil for a language without the words.
    func restInChatWords(messages: [Message]) -> String? {
        let language = CallProgress.language(
            callLanguage: callVoiceSettings.language,
            lastUserText: CallProgress.lastUserText(messages),
            appLanguage: Bundle.main.preferredLocalizations.first ?? "en"
        )
        let english = "The rest is written in the chat."
        if let bundle = Self.wordsBundle(language), Self.hasWords(english, in: bundle) {
            return String(localized: "The rest is written in the chat.", bundle: bundle, locale: Locale(identifier: language))
        }
        let lower = language.lowercased()
        return lower == "en" || lower.hasPrefix("en-") ? english : nil
    }

    /// The sentence a failed turn is said with (CallFailure), in the call's
    /// language like the progress lines; English when that language has no
    /// words for it (never silence after a failure).
    func failureWords(_ kind: CallFailureKind, messages: [Message]) -> String {
        let language = CallProgress.language(
            callLanguage: callVoiceSettings.language,
            lastUserText: CallProgress.lastUserText(messages),
            appLanguage: Bundle.main.preferredLocalizations.first ?? "en"
        )
        let english: String
        switch kind {
        case .busy: english = "The model is overloaded right now. Try again in a minute."
        case .limit: english = "My engine has reached its usage limit. Try again later."
        case .quota: english = "My engine has run out of credits. Check its plan in the app."
        case .signIn: english = "I can't reach my engine: it needs a new sign-in. Open the app to sign in again."
        case .connection: english = "I lost the connection on that one. Say it again in a moment."
        case .generic: english = "That didn't work on my side. The details are in the chat."
        }
        guard let bundle = Self.wordsBundle(language), Self.hasWords(english, in: bundle) else { return english }
        let locale = Locale(identifier: language)
        switch kind {
        case .busy: return String(localized: "The model is overloaded right now. Try again in a minute.", bundle: bundle, locale: locale)
        case .limit: return String(localized: "My engine has reached its usage limit. Try again later.", bundle: bundle, locale: locale)
        case .quota: return String(localized: "My engine has run out of credits. Check its plan in the app.", bundle: bundle, locale: locale)
        case .signIn: return String(localized: "I can't reach my engine: it needs a new sign-in. Open the app to sign in again.", bundle: bundle, locale: locale)
        case .connection: return String(localized: "I lost the connection on that one. Say it again in a moment.", bundle: bundle, locale: locale)
        case .generic: return String(localized: "That didn't work on my side. The details are in the chat.", bundle: bundle, locale: locale)
        }
    }

    /// The app's own words in one language: that language's .lproj (exact,
    /// then its base language). English is the strings' source language.
    private static func wordsBundle(_ language: String) -> Bundle? {
        let wanted = language.lowercased()
        let base = String(wanted.split(separator: "-").first ?? "")
        let available = Bundle.main.localizations
        let match = available.first { $0.lowercased() == wanted }
            ?? available.first { $0.lowercased() == base }
        if let match, let path = Bundle.main.path(forResource: match, ofType: "lproj"), let bundle = Bundle(path: path) {
            return bundle
        }
        return nil
    }

    private static let missing = "\u{1}missing"

    /// The bundle says these words itself (no fall-back to the key).
    private static func hasWords(_ key: String, in bundle: Bundle) -> Bool {
        bundle.localizedString(forKey: key, value: missing, table: nil) != missing
    }

    private func speaker(_ id: String?) -> CallSpeaker? {
        switch target {
        case let .bot(bot)?:
            return CallSpeaker(id: bot.id, name: bot.name, voice: bot.voice)
        case .room?:
            guard let id, let index = members.firstIndex(where: { $0.id == id }) else { return nil }
            let member = members[index]
            return CallSpeaker(id: member.id, name: member.name, voice: member.voice, index: index)
        case nil:
            return nil
        }
    }

    // MARK: - Words the call says on its own

    func words(_ prompt: CallPrompt) -> String {
        switch prompt {
        case let .approval(requester, kind, tool, title, detail, updating):
            switch kind {
            case .skill where CarRoute.isDriving:
                // in the car nothing says to look at the phone (CarPlay rule):
                // it waits, and a no is still heard
                return updating
                    ? String(localized: "\(requester) wants to update a learned skill. It will wait until you have stopped. You can say no to deny it.")
                    : String(localized: "\(requester) wants to enable a learned skill. It will wait until you have stopped. You can say no to deny it.")
            case .skill:
                return updating
                    ? String(localized: "\(requester) wants to update a learned skill. Open this chat to review it first. You can say no to deny it.")
                    : String(localized: "\(requester) wants to enable a learned skill. Open this chat to review it first. You can say no to deny it.")
            case .routine, .profile:
                let line = title.trimmingCharacters(in: .whitespacesAndNewlines)
                if CarRoute.isDriving { return String(localized: "\(requester) asks: \(line) Should I confirm it?") }
                return String(localized: "\(requester) asks: \(line) Review it on screen. Should I confirm it?")
            case .command:
                let action: String = switch tool {
                case "Bash", "shell": String(localized: "run a command")
                case "Read": String(localized: "read a file")
                case "Write", "Edit", "edit": String(localized: "change a file")
                default: String(localized: "use \(tool)")
                }
                // shorter in the car (DrivingSafety)
                let shown = DrivingSafety.spokenDetail(detail, driving: CarRoute.isDriving)
                // asked with its two options; the answer must pick one (CallAnswers.decision)
                return String(localized: "\(requester) wants to \(action). \(shown). Allow once, or deny?")
            }
        case let .question(requester, subtitle, options):
            let detail = subtitle.trimmingCharacters(in: .whitespacesAndNewlines)
            let end = detail.last.map { ".!?".contains($0) } == true ? "" : "."
            let choices = options.isEmpty ? "" : " " + options.joined(separator: ", ") + "."
            if case .room = target { return String(localized: "\(requester) asks: \(detail)\(end)\(choices)") }
            return "\(detail)\(end)\(choices)"
        case .allowOnceOrDeny:
            return String(localized: "Sorry, I need one of the two answers: allow once, or deny?")
        case .skillReview where CarRoute.isDriving:
            return String(localized: "A skill is enabled once you have read it, after the drive. You can say no now to deny it.")
        case .skillReview:
            return String(localized: "Open this chat to review the complete skill before enabling it. You can say no now to deny it.")
        case .approvalFailed:
            return String(localized: "I couldn't save that decision. Please try again.")
        }
    }

    /// The server ended this call. Mute at once. A goodbye that is already
    /// spoken finishes; then the call ends. The person's own button does
    /// not wait, and `end()` has already cleared `target` before its echo
    /// frame arrives, so this no-ops for the device that hung up.
    private func hangUpFromServer(threadId: String, callId: String) {
        guard serverHangupObserver != nil, target != nil, self.threadId == threadId, self.callId == callId else { return }
        setMuted(true)
        serverHangup?.cancel()
        let started = Date()
        serverHangup = Task { @MainActor in
            var heardSpeech = false
            while !Task.isCancelled {
                let speaking = (self.player?.busy ?? false) || self.state.phase == .speaking
                if speaking { heardSpeech = true }
                let elapsed = Date().timeIntervalSince(started) * 1000
                if BotHangup.decide(speaking: speaking, heardSpeech: heardSpeech, elapsedMs: elapsed) == .hangup {
                    break
                }
                try? await Task.sleep(nanoseconds: 100_000_000)
            }
            guard !Task.isCancelled, self.target != nil, self.callId == callId else { return }
            self.end()
        }
    }

    // MARK: - Interruptions and routes

    private func observeAudioSession() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let raw = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue
            let options = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? NSNumber)?.uintValue ?? 0
            DispatchQueue.main.async {
                guard let self, self.callKit == nil else { return } // CallKit sends its own hold
                if raw == AVAudioSession.InterruptionType.began.rawValue {
                    self.engine?.hold()
                } else if AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume) {
                    self.interruptionPending = true
                    self.resumeAfterInterruption()
                } else {
                    // ended without .shouldResume (the other app kept the
                    // audio): resume once the app is active again, or on a tap
                    self.interruptionPending = true
                    self.notice = String(localized: "The call was interrupted. Tap Resume the call to continue.")
                    if UIApplication.shared.applicationState == .active { self.resumeAfterInterruption() }
                }
            }
        })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, self.interruptionPending, self.callKit == nil else { return }
                self.resumeAfterInterruption()
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            DispatchQueue.main.async { self?.rebuildAfterMediaReset() }
        })
        observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: .main) { [weak self] _ in
            // AirPods in or out, a Bluetooth headset: the engine starts over on the new route
            DispatchQueue.main.async { self?.io?.restart() }
        })
    }

    // MARK: - Settings that travel (organization servers)

    private func seedVoiceSettings(_ client: CompanionClient) async {
        guard UserDefaults.standard.string(forKey: VoiceModeSettings.storageKey) == nil,
              let preferences = try? await client.preferences(),
              let raw = preferences.preferences[VoiceModeSettings.storageKey] else { return }
        voiceSettings = VoiceModeSettings.decode(raw)
    }

    private func syncVoiceSettings() {
        guard organization, let client = session?.callClient else { return }
        let encoded = voiceSettings.encoded
        Task {
            guard var preferences = try? await client.preferences().preferences else { return }
            preferences[VoiceModeSettings.storageKey] = encoded
            _ = try? await client.putPreferences(preferences)
        }
    }

    private func roomOnOrganization(session: Session, client: CompanionClient) async -> Bool {
        guard let anyBot = session.state.bots.first else { return false }
        return (try? await client.voiceModeStatus(botId: anyBot.id))?.organization == true
    }

    private static func refusal(_ refusal: VoiceModeRefusal?, botName: String) -> Unavailable {
        let lines = VoiceWords.refusalLines(cause: refusal?.cause ?? "no_credentials", admin: refusal?.admin == true)
        return Unavailable(title: String(localized: "Voice mode unavailable"), lines: lines, keysUrl: refusal?.keysUrl.flatMap(URL.init(string:)))
    }

    /// The server's answer about voice mode, asked twice (a blip is not a
    /// reason to fall to Apple's ears), else why it could not answer.
    static func askVoiceStatus(_ client: CompanionClient, botId: String) async -> (VoiceModeStatus?, String?) {
        var reason: String?
        for attempt in 0..<2 {
            do { return (try await client.voiceModeStatus(botId: botId), nil) } catch {
                reason = error.localizedDescription
                if attempt == 0 { try? await Task.sleep(nanoseconds: 300_000_000) }
            }
        }
        return (nil, reason)
    }

    /// Which key served a request: the provider line follows, and a key
    /// refused on the way is said once.
    private func noteKeyOutcome(_ outcome: VoiceKeyOutcome) {
        guard target != nil else { return }
        if let used = outcome.used, used != voiceKey { voiceKey = used }
        if let line = outcome.fallbackLine, line != keyFallbackSaid {
            keyFallbackSaid = line
            notice = line
        }
    }

    /// What the bar says for a room's call (GroupCallView's status line).
    static func roomPhaseLabel(_ state: CallState, speaking: Bot?, working: Bot?, push: Bool) -> String {
        if state.phase == .held { return String(localized: "On hold") }
        if state.muted { return String(localized: "Muted") }
        switch state.phase {
        case .connecting: return String(localized: "Connecting")
        case .listening, .hearing, .interrupted:
            return push ? String(localized: "Push to talk") : String(localized: "Listening")
        case .speaking:
            return String(localized: "\(speaking?.name ?? String(localized: "Group member")) is speaking")
        default:
            if let working { return String(localized: "\(working.name) is working") }
            return String(localized: "Bringing the group in")
        }
    }

    /// What the bar says for each state of the call (desktop phaseLabel).
    static func phaseLabel(_ state: CallState) -> String {
        if state.phase == .held { return String(localized: "On hold") }
        if state.muted { return String(localized: "Muted") }
        switch state.phase {
        case .connecting: return String(localized: "Connecting")
        case .listening: return String(localized: "Listening")
        case .hearing: return String(localized: "Listening to you")
        case .thinking: return String(localized: "Thinking")
        case .speaking: return String(localized: "Speaking")
        case .interrupted: return String(localized: "Interrupted")
        case .held, .ended: return ""
        }
    }
}
