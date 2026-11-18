// Push to Talk on this phone (docs/ios-push.md "Push to Talk"): the system
// puts a talk button on the lock screen and in the Dynamic Island for ONE
// channel, which talks to ONE bot (the person's choice, else their Primary
// Bot).
//
// Talking: while the person holds, the system activates the audio session;
// the words are recognized on this phone by the call's own recognizer
// (CallRecognizer) and sent to the bot as a call turn (the voice path of
// a live call: the bot answers with its phone-call instructions, in its own
// thread). Hearing: the server sends an incoming PTT push when the bot has
// answered; the system wakes the app, activates the audio session, and the
// answer is spoken with the bot's own voice (RoutedSpeechSource and
// CallSpeechPlayer, the call's voice).
//
// A channel can only be joined from the foreground, by the person (the
// switch in Settings); the system then keeps it on the lock screen and
// restores it after a restart.
import AVFoundation
import CompanionCore
import Foundation
import os
import PushToTalk
import UIKit

@MainActor
final class PushToTalkController: NSObject, ObservableObject {
    static let shared = PushToTalkController()
    private let log = Logger(subsystem: "ca.pulsatrix.sagax", category: "ptt")
    let prefs = PushToTalkPrefs()

    enum Phase: Equatable { case off, joining, ready, listening, sending, speaking }
    @Published private(set) var phase = Phase.off
    @Published private(set) var botName = ""
    /// Why the channel is not on, in words for Settings.
    @Published private(set) var problem: String?

    private var manager: PTChannelManager?
    private var token: String?
    private var registeredFor: String?
    private var io: CallAudioIO?
    private var recognizer: CallRecognizer?
    private var player: CallSpeechPlayer?
    private var incoming: PushToTalkIncoming?
    private var transmitting = false
    private var recognizerReady = false

    static var isSupported: Bool {
        #if targetEnvironment(simulator)
        return false
        #else
        return true
        #endif
    }

    /// At launch (also when iOS launched the app in the background for a
    /// push): the channel manager must exist at once, or the system drops
    /// the channel and its pushes.
    func start() {
        guard Self.isSupported, prefs.enabled, manager == nil else { return }
        phase = .joining
        Task { await createManager() }
    }

    /// The person turned Push to Talk on (foreground, explicit).
    func enable() async {
        guard Self.isSupported else {
            problem = String(localized: "Push to Talk needs an iPhone.")
            return
        }
        problem = nil
        prefs.enabled = true
        phase = .joining
        await createManager()
        await join()
    }

    /// The person turned it off.
    func disable() async {
        prefs.enabled = false
        if let manager { manager.leaveChannel(channelUUID: prefs.channelUUID) }
        phase = .off
        registeredFor = nil
        if let client = SessionHub.session.callClient { try? await client.removePushToTalk() }
    }

    /// The bot of the channel changed (Settings): the channel is renamed and
    /// the server told.
    func botChanged() async {
        guard prefs.enabled, manager != nil else { return }
        registeredFor = nil
        await updateDescriptor()
        await registerToken()
    }

    /// The bot the channel talks to now.
    func currentBot() -> Bot? {
        PrimaryBotChoice.bot(chosenId: prefs.botId, bots: SessionHub.session.state.bots)
    }

    // MARK: - Channel

    private func createManager() async {
        guard manager == nil else { return }
        do {
            manager = try await PTChannelManager.channelManager(delegate: self, restorationDelegate: self)
        } catch {
            problem = String(localized: "Push to Talk could not start.")
            log.error("channel manager failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func join() async {
        guard let manager else { return }
        await waitForBots()
        guard let bot = currentBot() else {
            problem = String(localized: "Push to Talk needs a bot to talk to.")
            phase = .off
            return
        }
        prefs.channelName = bot.name
        botName = bot.name
        manager.requestJoinChannel(channelUUID: prefs.channelUUID, descriptor: PTChannelDescriptor(name: bot.name, image: nil))
    }

    private func updateDescriptor() async {
        guard let manager, let bot = currentBot() else { return }
        prefs.channelName = bot.name
        botName = bot.name
        try? await manager.setChannelDescriptor(PTChannelDescriptor(name: bot.name, image: nil), channelUUID: prefs.channelUUID)
    }

    /// The session may still be loading after a launch in the background.
    private func waitForBots() async {
        let session = SessionHub.session
        session.connect()
        for _ in 0..<40 where session.state.bots.isEmpty {
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
    }

    private func registerToken() async {
        guard let token, let bot = currentBot(), let client = SessionHub.session.callClient else { return }
        let marker = token + "|" + bot.id
        guard registeredFor != marker else { return }
        let registration = PushToTalkRegistration(
            token: token, channelId: prefs.channelUUID, botId: bot.id,
            environment: PushRegistrar.environment, appVersion: PushRegistrar.appVersion
        )
        do {
            try await client.registerPushToTalk(registration)
            registeredFor = marker
            log.info("PTT channel registered")
        } catch {
            log.notice("PTT registration refused: \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: - Holding to talk

    /// The on-screen hold button (Settings page): same as the system one.
    func beginTransmitting() { manager?.requestBeginTransmitting(channelUUID: prefs.channelUUID) }
    func stopTransmitting() { manager?.stopTransmitting(channelUUID: prefs.channelUUID) }

    private func startListening() async {
        guard await MicrophonePermission.request() else {
            problem = String(localized: "Allow microphone access for Sagax in Settings.")
            stopTransmitting()
            return
        }
        let recognizer = CallRecognizer()
        let voice = VoiceModeSettings.decode(UserDefaults.standard.string(forKey: VoiceModeSettings.storageKey))
        recognizerReady = await recognizer.prepare(locales: voice.recognitionLocales(), upload: nil)
        guard transmitting, recognizerReady else { return }
        self.recognizer = recognizer
        let io = CallAudioIO()
        io.onFrame = { [weak recognizer] frame in recognizer?.push(frame) }
        do {
            try CallAudioIO.configureSession()
            recognizer.begin(preroll: [])
            try io.start(capture: true)
            self.io = io
            phase = .listening
        } catch {
            recognizer.discard()
            log.error("PTT capture failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func finishListening() async {
        io?.stop()
        io = nil
        guard let recognizer else { return }
        self.recognizer = nil
        let words = await recognizer.finish().trimmingCharacters(in: .whitespacesAndNewlines)
        recognizer.close()
        guard !words.isEmpty, let bot = currentBot() else {
            phase = .ready
            return
        }
        phase = .sending
        // the send finishes even if the app is put to sleep right after
        var task = UIBackgroundTaskIdentifier.invalid
        task = UIApplication.shared.beginBackgroundTask { UIApplication.shared.endBackgroundTask(task) }
        defer { if task != .invalid { UIApplication.shared.endBackgroundTask(task) } }
        let session = SessionHub.session
        session.connect()
        let meta = VoiceCallMeta(callId: PushToTalkChannel.callId(), language: voice().language, utteranceId: "utt-" + UUID().uuidString.lowercased())
        let sent = await session.sendCallTurn(words, to: bot, threadId: bot.threadId, voiceCall: meta)
        session.actionError = nil
        if !sent { log.notice("PTT turn was not sent") }
        phase = .ready
    }

    private func voice() -> VoiceModeSettings {
        VoiceModeSettings.decode(UserDefaults.standard.string(forKey: VoiceModeSettings.storageKey))
    }

    // MARK: - Hearing the answer

    private func speakIncoming() async {
        guard let incoming, let manager else { return }
        phase = .speaking
        let session = SessionHub.session
        session.connect()
        await waitForBots()
        guard let client = session.callClient else { await doneSpeaking(); return }
        let bot = incoming.botId.flatMap { session.state.bot($0) } ?? currentBot()
        let settings = voice()
        let status: VoiceModeStatus? = if let bot { await CallController.askVoiceStatus(client, botId: bot.id).0 } else { nil }
        let config = await session.configStatus()
        let botVoice = bot?.voice
        let route: (CallSpeaker?) -> [CallVoiceSource] = { speaker in
            CallVoiceSource.route(voiceMode: status, config: config, agentVoice: speaker?.voice ?? botVoice, phoneKey: WalkieVoiceKey.read() != nil)
        }
        let source = RoutedSpeechSource(
            client: client, botId: bot?.id, threadId: { bot?.threadId }, routes: route,
            settings: { settings.forBot(bot?.id) }
        )
        let io = CallAudioIO()
        let player = CallSpeechPlayer(io: io, source: source)
        if let bot { player.speaker = CallSpeaker(id: bot.id, name: bot.name, voice: bot.voice) }
        player.onIdle = { [weak self] in Task { @MainActor in await self?.doneSpeaking() } }
        self.io = io
        self.player = player
        do {
            try CallAudioIO.configureSession()
            try io.start(capture: false)
        } catch {
            log.error("PTT playback failed: \(error.localizedDescription, privacy: .public)")
            await doneSpeaking()
            return
        }
        let sentences = PushToTalkSpeech.sentences(incoming.text)
        if sentences.isEmpty { await doneSpeaking(); return }
        for sentence in sentences { player.enqueue(sentence) }
        _ = manager
    }

    private func doneSpeaking() async {
        player?.close()
        player = nil
        io?.stop()
        io = nil
        incoming = nil
        phase = .ready
        // nobody speaks any more: the system may drop the audio session and the person may talk again
        if let manager { try? await manager.setActiveRemoteParticipant(nil, channelUUID: prefs.channelUUID) }
    }
}

// MARK: - The system's side

extension PushToTalkController: PTChannelManagerDelegate {
    nonisolated func channelManager(_ channelManager: PTChannelManager, didJoinChannel channelUUID: UUID, reason: PTChannelJoinReason) {
        Task { @MainActor in
            self.phase = .ready
            self.problem = nil
            try? await channelManager.setTransmissionMode(.halfDuplex, channelUUID: channelUUID)
            await self.updateDescriptor()
            await self.registerToken()
        }
    }

    nonisolated func channelManager(_ channelManager: PTChannelManager, didLeaveChannel channelUUID: UUID, reason: PTChannelLeaveReason) {
        Task { @MainActor in
            self.phase = .off
            self.registeredFor = nil
            // the person left from the system's own button: the switch follows
            if reason == .userRequest || reason == .systemPolicy { self.prefs.enabled = false }
            if let client = SessionHub.session.callClient { try? await client.removePushToTalk() }
        }
    }

    nonisolated func channelManager(_ channelManager: PTChannelManager, failedToJoinChannel channelUUID: UUID, error: Error) {
        Task { @MainActor in
            self.phase = .off
            self.problem = String(localized: "Push to Talk could not join. Another app may be using the channel.")
            self.log.error("join failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    nonisolated func channelManager(_ channelManager: PTChannelManager, receivedEphemeralPushToken pushToken: Data) {
        let hex = PushToken.hex(pushToken)
        Task { @MainActor in
            self.token = hex
            self.registeredFor = nil
            await self.registerToken()
        }
    }

    nonisolated func channelManager(_ channelManager: PTChannelManager, channelUUID: UUID, didBeginTransmittingFrom source: PTChannelTransmitRequestSource) {
        Task { @MainActor in self.transmitting = true }
    }

    nonisolated func channelManager(_ channelManager: PTChannelManager, channelUUID: UUID, didEndTransmittingFrom source: PTChannelTransmitRequestSource) {
        Task { @MainActor in
            self.transmitting = false
            await self.finishListening()
        }
    }

    nonisolated func channelManager(_ channelManager: PTChannelManager, didActivate audioSession: AVAudioSession) {
        Task { @MainActor in
            if self.incoming != nil {
                await self.speakIncoming()
            } else if self.transmitting {
                await self.startListening()
            }
        }
    }

    nonisolated func channelManager(_ channelManager: PTChannelManager, didDeactivate audioSession: AVAudioSession) {
        Task { @MainActor in
            if self.phase == .listening { self.io?.stop(); self.io = nil }
        }
    }

    nonisolated func incomingPushResult(channelManager: PTChannelManager, channelUUID: UUID, pushPayload: [String: Any]) -> PTPushResult {
        // no speaker named: the channel is over, never a mystery voice
        guard let incoming = PushToTalkIncoming(payload: pushPayload) else { return .leaveChannel }
        Task { @MainActor in self.incoming = incoming }
        return .activeRemoteParticipant(PTParticipant(name: incoming.speaker, image: nil))
    }
}

extension PushToTalkController: PTChannelRestorationDelegate {
    /// Answered at once, from what this phone kept: no network.
    nonisolated func channelDescriptor(restoredChannelUUID channelUUID: UUID) -> PTChannelDescriptor {
        PTChannelDescriptor(name: PushToTalkPrefs().channelName, image: nil)
    }
}
