// Side Button Access (iOS 26.2, docs/ios-push.md "Side button"): a person may
// press and hold the side button to launch Sagax straight into a voice
// conversation with their Primary Bot. Apple's activate schema of the
// App Intents framework (`@AppIntent(schema: .assistant.activate)`) and the
// `com.apple.developer.side-button-access.allow` entitlement; the system
// offers it only on an iPhone in Japan (Apple: the Apple Account's region and
// the physical location), a restriction we do not add to or remove.
//
// perform() runs in the foreground app and starts the existing voice mode (a
// live call, CallController) at once, like "call Scout with Sagax" from Siri
// or the car (CarCalls); the bot is the person's Primary Bot (PrimaryBotChoice).
import AppIntents
import CompanionCore
import Foundation

@MainActor
enum SideButtonLaunch {
    /// The call the side button asked for. The session may still be loading
    /// after a launch: it waits for the bots, a few seconds at most.
    static func startVoiceConversation() async {
        let session = SessionHub.session
        session.connect()
        for _ in 0..<60 where session.state.bots.isEmpty {
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
        guard let bot = PrimaryBotChoice.bot(chosenId: nil, bots: session.state.bots) else { return }
        await CarCalls.call(contactId: bot.id)
    }
}

@available(iOS 26.2, *)
@AppIntent(schema: .assistant.activate)
struct ActivateSagaxVoiceIntent {
    static let supportedModes: IntentModes = .foreground

    func perform() async throws -> some IntentResult {
        await SideButtonLaunch.startVoiceConversation()
        return .result()
    }
}
