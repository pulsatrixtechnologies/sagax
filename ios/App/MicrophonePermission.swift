// Microphone access, asked the way each system wants it. Shared by the
// phone and the watch (the watch's push-to-talk and meeting recording).
import AVFoundation

enum MicrophonePermission {
    /// Never asked yet: the next request shows the system prompt.
    static var undetermined: Bool {
        #if os(iOS)
        if #available(iOS 17.0, *) {
            return AVAudioApplication.shared.recordPermission == .undetermined
        }
        return AVAudioSession.sharedInstance().recordPermission == .undetermined
        #else
        return AVAudioApplication.shared.recordPermission == .undetermined
        #endif
    }

    /// `AVAudioApplication.requestRecordPermission()` arrived in iOS 17; the
    /// session-based call it replaced still works below that. The watch
    /// (watchOS 10 and later) always has the new one.
    static func request() async -> Bool {
        #if os(iOS)
        if #available(iOS 17.0, *) {
            return await AVAudioApplication.requestRecordPermission()
        }
        return await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { continuation.resume(returning: $0) }
        }
        #else
        return await AVAudioApplication.requestRecordPermission()
        #endif
    }
}
