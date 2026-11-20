// Push-to-talk on Apple Watch (#5129, D-20261120-004): hold the mic, speak,
// let go. The words are heard by the app's own speech to text (the voice
// notes' `/voice/transcribe`, `transcribeRecording`), go to the bot as a
// call turn (`voiceCall`, like the phone's Push to Talk, so the bot answers
// in its spoken register), and the answer is shown in the watch's chat and
// read aloud by the app's own reader (MessageSpeaker) in the bot's voice.
//
// What is decided here, apart from the microphone and the speaker: the call
// id, when the bot's turn still runs, and which voice settings apply.
import Foundation

public enum WatchTalk {
    /// A call id of the watch: never `ptt-`, which the server answers as a
    /// phone Push to Talk push (server/push/ptt.ts).
    public static let callPrefix = "watch-"
    /// How long the watch waits for an answer to say aloud; the text still
    /// lands in the chat after it.
    public static let answerWait: TimeInterval = 180
    /// How often the watch looks for the answer while it waits.
    public static let answerPoll: TimeInterval = 1.5

    public static func callId() -> String { callPrefix + UUID().uuidString.lowercased() }
    public static func utteranceId() -> String { "utt-" + UUID().uuidString.lowercased() }

    /// The turn of this conversation still runs. A wait on a teammate is not
    /// the bot's own work (the roster's rule); a wait on the person counts,
    /// and `Walkie.settledReply` then says only its question.
    public static func turnRuns(_ bot: Bot?, threadId: String) -> Bool {
        guard let bot else { return false }
        if let thread = bot.statusThreads.first(where: { $0.threadId == threadId }) {
            return thread.isWorking && !thread.isWaitingOnTeammate
        }
        return bot.busy == true && bot.waitingOnTeammate != true
    }

    /// The person's voice settings as their app keeps them on the server
    /// (the call seeds the phone from the same preference); the defaults
    /// when there are none.
    public static func voiceSettings(preferences: [String: String]) -> VoiceModeSettings {
        VoiceModeSettings.decode(preferences[VoiceModeSettings.storageKey])
    }
}
