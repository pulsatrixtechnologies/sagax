import XCTest
@testable import CompanionCore

final class VoiceProvidersTests: XCTestCase {
    func testASoloInstallationsVoiceBecomesThePersonsChoiceElevenLabsByDefault() {
        XCTAssertEqual(VoiceModeSettings.installed(provider: nil, voice: nil).personTts, "elevenlabs")
        XCTAssertEqual(VoiceModeSettings.installed(provider: "openai", voice: "nova").personTts, "openai")
        XCTAssertEqual(VoiceModeSettings.installed(provider: "openai", voice: "nova").personVoice(of: "openai"), "nova")
        XCTAssertEqual(VoiceModeSettings.installed(provider: "bogus", voice: nil).personTts, "elevenlabs")
    }

    func testThePickedProviderStaysListedWithoutItsKey() {
        let options = VoiceProviderChoice.options(
            offered: ["xai", "openai"], all: VoiceModeSettings.ttsProviders, picked: "elevenlabs", auto: "Auto",
            label: { VoiceProviderChoice.label($0, system: "System", chatterbox: "Chatterbox") },
            noKey: { "\($0) (no key)" })
        XCTAssertEqual(options.map(\.1), ["Auto", "xAI", "OpenAI", "ElevenLabs (no key)"])
    }

    func testSpeechToTextIsThePersonsOwnProvider() {
        let settings = VoiceModeSettings().withStt("openai")
        XCTAssertEqual(settings.personStt, "openai")
        XCTAssertEqual(settings.withStt(nil).personStt, "auto")
        XCTAssertEqual(VoiceModeSettings.decode(settings.encoded).personStt, "openai")
    }

    func testTheStatusAsksForTheChoiceAndTheTestNamesTheProvider() throws {
        let client = CompanionClient(connection: Connection(id: "c", name: "c", host: "example.test", port: 443), token: "t")
        let status = try client.voiceProvidersStatusRequest(tts: "elevenlabs", stt: "auto")
        XCTAssertEqual(status.url?.path, "/api/voice/status")
        XCTAssertTrue(status.url?.query?.contains("tts=elevenlabs") == true)
        let test = try client.testVoiceRequest(text: "Hi", settings: VoiceModeSettings().withTts("openai"))
        let body = try JSONSerialization.jsonObject(with: test.httpBody ?? Data()) as? [String: Any]
        XCTAssertEqual(body?["tts"] as? String, "openai")
        XCTAssertEqual(test.url?.path, "/api/voice/speak")
    }
}
