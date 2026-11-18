// Sagax in the car (docs/ios-carplay.md), the app's side: the one Session
// the phone, Siri and the car share, whether the phone is in a car, the
// Siri permission, and starting a call that Siri or the car asked for.
// The decisions (who a name is, what the car may show) are CompanionCore's
// CarAssist.swift.
import AVFoundation
import CompanionCore
import Foundation
import Intents

/// The app's one Session. The phone's window, Siri's requests and the car's
/// screen all read the same one, so a call started from the car is the call
/// the phone shows.
@MainActor
enum SessionHub {
    static let session = Session()
}

/// Whether the phone is in a car: CarPlay's screen is connected (with the
/// CarPlay entitlement), or the audio goes to a car (CarPlay or a car's
/// Bluetooth, which needs no entitlement). A call then speaks the way the car
/// needs: short, and never "look at the screen" (DrivingSafety).
enum CarRoute {
    /// Set by the CarPlay scene (CarPlaySceneDelegate).
    nonisolated(unsafe) static var carPlayConnected = false

    static var isDriving: Bool {
        if carPlayConnected { return true }
        return AVAudioSession.sharedInstance().currentRoute.outputs.contains { $0.portType == .carAudio }
    }
}

/// Siri's permission, asked once, the first time the person calls a bot:
/// the moment "call Scout with Sagax" makes sense.
enum SiriAccess {
    static func askOnce() {
        guard INPreferences.siriAuthorizationStatus() == .notDetermined else { return }
        INPreferences.requestSiriAuthorization { _ in }
    }
}

/// Who Siri and the car can reach, for a request that may come before the
/// app has loaded anything (Siri wakes it in the background): the session's
/// bots when it has them, else the paired computer's, read once.
@MainActor
enum CarContacts {
    static func current() async -> [CarContact] {
        let session = SessionHub.session
        if session.isDemo { return [] }
        if !session.state.bots.isEmpty {
            return CarDirectory.contacts(bots: session.state.bots, rooms: session.state.rooms)
        }
        guard let client = standaloneClient() else { return [] }
        guard let fleet = try? await client.fleet(messages: 1) else { return [] }
        return CarDirectory.contacts(bots: fleet.bots, rooms: fleet.groups)
    }

    /// The client a request goes out on: the session's, or one made from
    /// the pairing the share sheet and the notification extension read.
    static func client() -> CompanionClient? {
        SessionHub.session.callClient ?? standaloneClient()
    }

    private static func standaloneClient() -> CompanionClient? {
        guard let connection = SagaxSharedConnectionStore.loadActiveConnection(),
              let token = try? SagaxSharedKeychain.token(for: connection.id), !token.isEmpty
        else { return nil }
        return CompanionClient(connection: connection, token: token, requestTimeout: 10)
    }
}

/// A call Siri, the car or a call-back asked for, by the bot's (or
/// channel's) id. The session may still be loading after a launch in the
/// background: it waits for the bot to be known, a few seconds at most.
@MainActor
enum CarCalls {
    /// Calls being placed: Siri's handler and the activity it hands the
    /// window ask for the same call; the second one waits for nothing.
    private static var placing: Set<String> = []

    static func call(contactId: String) async {
        guard !placing.contains(contactId) else { return }
        placing.insert(contactId)
        defer { placing.remove(contactId) }
        let session = SessionHub.session
        session.connect()
        for _ in 0..<60 {
            if let chat = chat(contactId, in: session) {
                session.openBot(id: contactId)
                await CallController.shared.start(chat, session: session)
                return
            }
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
    }

    /// The bot or channel in a Siri call request (its resolved contact, or
    /// the handle of a call made before).
    static func contactId(in activity: NSUserActivity) -> String? {
        guard let intent = activity.interaction?.intent as? INStartCallIntent,
              let person = intent.contacts?.first
        else { return nil }
        if let id = person.customIdentifier, !id.isEmpty { return CarCallHandle.contactId(from: id) ?? id }
        let handle = person.personHandle?.value
        return CarCallHandle.contactId(from: handle) ?? handle
    }

    private static func chat(_ id: String, in session: Session) -> Chat? {
        if let bot = session.state.bot(id) { return .bot(bot) }
        if let room = session.state.rooms.first(where: { $0.id == id }) { return .room(room) }
        return nil
    }
}

extension Notification.Name {
    /// A notification was tapped while CarPlay is connected: the car's
    /// "To answer" tab opens (CarPlaySceneDelegate).
    static let sagaxCarOpenToAnswer = Notification.Name("sagax.car.openToAnswer")
}

/// Reads an ask aloud on the car's audio, short, on the call's rules: no
/// speech over a call, the audio session released after, the music resumes.
@MainActor
final class CarSpeaker: NSObject, AVSpeechSynthesizerDelegate {
    static let shared = CarSpeaker()
    private let synthesizer = AVSpeechSynthesizer()

    override private init() {
        super.init()
        synthesizer.delegate = self
    }

    func say(_ text: String) {
        guard CallController.shared.target == nil else { return }
        stop()
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
        try? session.setActive(true)
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: Locale.preferredLanguages.first)
        synthesizer.speak(utterance)
    }

    func stop() {
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
        release()
    }

    private func release() {
        guard CallController.shared.target == nil else { return }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.release() }
    }
}
