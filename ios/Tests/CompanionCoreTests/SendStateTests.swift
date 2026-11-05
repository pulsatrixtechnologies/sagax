// The composer's send state (SendState.swift, desktop src/lib/send-state.ts):
// a block only when the server says so plainly, anything else sends.
import XCTest
@testable import CompanionCore

final class SendStateTests: XCTestCase {
    private func parse(_ json: String) -> SendBlock? { SendBlock.parse(Data(json.utf8)) }

    func testConnectBlockParsed() throws {
        let block = try XCTUnwrap(parse(#"""
        {"block":{"reason":"engine_not_connected","name":"Claude","message":"Claude is not connected for you.","action":{"kind":"connect","instanceId":"claude-1","engine":"Claude"}}}
        """#))
        XCTAssertEqual(block.reason, .engineNotConnected)
        XCTAssertEqual(block.action, .connect(instanceId: "claude-1", engine: "Claude"))
        XCTAssertEqual(block.name, "Claude")
        XCTAssertEqual(block.engineName, "Claude")
        XCTAssertEqual(block.message, "Claude is not connected for you.")
    }

    /// The maintainer, 2026-11-04: an engine at its limit or out of credit locks the composer.
    func testEngineLimitBlockParsed() throws {
        let block = try XCTUnwrap(parse(#"""
        {"block":{"reason":"engine_limit","name":"Claude","message":"Claude limit reached.","action":{"kind":"switch_engine"},"limit":{"cause":"usage_limit","resetsAt":1800000000000}}}
        """#))
        XCTAssertEqual(block.reason, .engineLimit)
        XCTAssertEqual(block.action, .switchEngine)
        XCTAssertTrue(block.locksComposer)
        XCTAssertEqual(block.limitCause, "usage_limit")
        XCTAssertEqual(block.resetsAt, Date(timeIntervalSince1970: 1_800_000_000))
        let credits = try XCTUnwrap(parse(#"{"block":{"reason":"engine_limit","name":"Grok","message":"m","action":{"kind":"switch_engine"},"limit":{"cause":"credits"}}}"#))
        XCTAssertEqual(credits.limitCause, "credits")
        XCTAssertNil(credits.resetsAt)
        let other = try XCTUnwrap(parse(#"{"block":{"reason":"computer_offline","message":"m","action":{"kind":"retry"}}}"#))
        XCTAssertFalse(other.locksComposer)
    }

    /// #2013: an engine refusal before any prompt went out is advisory: the
    /// line shows, the composer still sends; Fix and Try again read.
    func testEngineRefusedAdvisoryWithFix() throws {
        let block = try XCTUnwrap(parse(#"""
        {"block":{"reason":"engine_refused","name":"Codex","advisory":true,"message":"Codex has its own settings that conflict with this bot's tools. Nothing was sent.","action":{"kind":"fix","fix":"codex_native_mcp"},"refusal":{"kind":"config_conflict","cause":"Codex has an MCP server outside the selected configuration."}}}
        """#))
        XCTAssertEqual(block.reason, .engineRefused)
        XCTAssertEqual(block.action, .fix("codex_native_mcp"))
        XCTAssertTrue(block.isAdvisory)
        XCTAssertFalse(block.blocksSend)
        XCTAssertFalse(block.locksComposer)
        XCTAssertEqual(block.refusal, SendBlock.Refusal(kind: "config_conflict", cause: "Codex has an MCP server outside the selected configuration."))

        let resend = try XCTUnwrap(parse(#"{"block":{"reason":"engine_refused","name":"Codex","advisory":true,"message":"m","action":{"kind":"resend"},"refusal":{"kind":"engine_not_ready","cause":"c"}}}"#))
        XCTAssertEqual(resend.action, .resend)
        XCTAssertEqual(resend.refusal?.kind, "engine_not_ready")

        let signedOut = try XCTUnwrap(parse(#"{"block":{"reason":"engine_signed_out","name":"Codex","advisory":true,"message":"m","action":{"kind":"connect","instanceId":"codex-1","engine":"Codex"},"refusal":{"kind":"signed_out","cause":"401"}}}"#))
        XCTAssertEqual(signedOut.reason, .engineSignedOut)
        XCTAssertTrue(signedOut.isAdvisory)

        // a fix without its id is not a block this build can act on
        XCTAssertNil(parse(#"{"block":{"reason":"engine_refused","advisory":true,"message":"m","action":{"kind":"fix"}}}"#))
    }

    func testAdvisoryBlockLetsTheComposerSend() throws {
        let advisory = try XCTUnwrap(parse(#"{"block":{"reason":"engine_refused","advisory":true,"message":"m","action":{"kind":"resend"}}}"#))
        var state = SendBlockState()
        let scope = SendBlockState.scope(botId: "ada", threadId: "t1", model: nil)
        state.record(advisory, for: scope)
        XCTAssertEqual(state.block(for: scope), advisory)
        XCTAssertTrue(state.allowsSend(for: scope))
        // a reason this build does not know, without advisory, still blocks
        let unknown = try XCTUnwrap(parse(#"{"block":{"reason":"something_new","message":"m","action":{"kind":"retry"}}}"#))
        XCTAssertNil(unknown.reason)
        XCTAssertTrue(unknown.blocksSend)
        state.record(unknown, for: scope)
        XCTAssertFalse(state.allowsSend(for: scope))
    }

    func testFixAnswerParsedAndRequestShaped() throws {
        let answer = try XCTUnwrap(SendStateFixResult.parse(Data(#"{"ok":true,"block":null}"#.utf8)))
        XCTAssertTrue(answer.ok)
        XCTAssertNil(answer.block)
        let refused = try XCTUnwrap(SendStateFixResult.parse(Data(#"{"ok":false,"block":{"reason":"engine_refused","advisory":true,"message":"m","action":{"kind":"resend"}}}"#.utf8)))
        XCTAssertFalse(refused.ok)
        XCTAssertEqual(refused.block?.action, .resend)

        let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t", session: .shared)
        let request = try client.sendStateFixRequest(botId: "ada", threadId: "t1", fix: "codex_native_mcp")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/bots/ada/send-state/fix")
        XCTAssertEqual(request.url?.query, "threadId=t1")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: String])
        XCTAssertEqual(body, ["fix": "codex_native_mcp"])
    }

    func testRetryBlocksParsed() throws {
        for reason in ["computer_offline", "local_server_offline", "owner_computer_offline"] {
            let block = try XCTUnwrap(parse(#"{"block":{"reason":"\#(reason)","message":"m","action":{"kind":"retry"}}}"#), reason)
            XCTAssertEqual(block.reason?.rawValue, reason)
            XCTAssertEqual(block.action, .retry)
            XCTAssertNil(block.name)
        }
        let owner = try XCTUnwrap(parse(#"{"block":{"reason":"owner_computer_offline","name":"Ada","message":"m","action":{"kind":"retry"}}}"#))
        XCTAssertEqual(owner.name, "Ada")
    }

    func testUnknownReasonStillBlocksWithTheServerLine() throws {
        let block = try XCTUnwrap(parse(#"{"block":{"reason":"something_new","message":"Not now.","action":{"kind":"retry"}}}"#))
        XCTAssertNil(block.reason)
        XCTAssertEqual(block.reasonCode, "something_new")
        XCTAssertEqual(block.message, "Not now.")
    }

    func testNullIsNotBlocked() {
        XCTAssertNil(parse(#"{"block":null}"#))
        XCTAssertNil(parse(#"{}"#))
    }

    func testMalformedIsNotBlocked() {
        XCTAssertNil(parse(""))
        XCTAssertNil(parse("not json"))
        XCTAssertNil(parse(#"[1,2]"#))
        XCTAssertNil(parse(#"{"block":"engine_not_connected"}"#))
        XCTAssertNil(parse(#"{"block":{"message":"m","action":{"kind":"retry"}}}"#))
        XCTAssertNil(parse(#"{"block":{"reason":"computer_offline","action":{"kind":"retry"}}}"#))
        XCTAssertNil(parse(#"{"block":{"reason":"computer_offline","message":"m"}}"#))
        XCTAssertNil(parse(#"{"block":{"reason":"computer_offline","message":"m","action":{"kind":"wait"}}}"#))
        XCTAssertNil(parse(#"{"block":{"reason":"engine_not_connected","message":"m","action":{"kind":"connect","engine":"Claude"}}}"#))
        XCTAssertNil(parse(#"{"block":{"reason":"engine_not_connected","message":"m","action":{"kind":"connect","instanceId":"x"}}}"#))
    }

    func testRequestCarriesTheThread() throws {
        let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t", session: .shared)
        let request = try client.sendStateRequest(botId: "b1", threadId: "t 1")
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/bots/b1/send-state")
        XCTAssertEqual(URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?.queryItems,
                       [URLQueryItem(name: "threadId", value: "t 1")])
        XCTAssertNil(try client.sendStateRequest(botId: "b1", threadId: nil).url?.query)
    }

    func testBadBotIdIsNotBlocked() async {
        let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t", session: .shared)
        let answer = await client.sendState(botId: "../x", threadId: nil)
        XCTAssertNil(answer)
    }

    // MARK: - The composer's state

    private let block = SendBlock(reasonCode: "computer_offline", message: "m", action: .retry)

    func testScopeFollowsBotThreadAndModel() {
        let claude = ModelSelection(instanceId: "claude-1", model: "a")
        let scope = SendBlockState.scope(botId: "ada", threadId: "t1", model: claude)
        XCTAssertNotNil(scope)
        XCTAssertNil(SendBlockState.scope(botId: nil, threadId: "t1", model: claude))
        XCTAssertNil(SendBlockState.scope(botId: "", threadId: "t1", model: claude))
        XCTAssertNotEqual(scope, SendBlockState.scope(botId: "grace", threadId: "t1", model: claude))
        XCTAssertNotEqual(scope, SendBlockState.scope(botId: "ada", threadId: "t2", model: claude))
        XCTAssertNotEqual(scope, SendBlockState.scope(botId: "ada", threadId: "t1", model: ModelSelection(instanceId: "local-1", model: "a")))
        XCTAssertNotEqual(scope, SendBlockState.scope(botId: "ada", threadId: "t1", model: ModelSelection(instanceId: "claude-1", model: "b")))
    }

    func testBlockedThenUnblockedByTheNextCheck() {
        var state = SendBlockState()
        let scope = SendBlockState.scope(botId: "ada", threadId: "t1", model: nil)
        XCTAssertTrue(state.allowsSend(for: scope))
        XCTAssertNil(state.recheckDelay(for: scope))

        state.record(block, for: scope)
        XCTAssertEqual(state.block(for: scope), block)
        XCTAssertFalse(state.allowsSend(for: scope))
        XCTAssertEqual(state.recheckDelay(for: scope), 15)

        state.record(nil, for: scope)
        XCTAssertTrue(state.allowsSend(for: scope))
        XCTAssertNil(state.recheckDelay(for: scope))
    }

    func testBlockStaysWithItsScope() {
        var state = SendBlockState()
        let ada = SendBlockState.scope(botId: "ada", threadId: "t1", model: nil)
        let grace = SendBlockState.scope(botId: "grace", threadId: "t9", model: nil)
        state.record(block, for: ada)
        XCTAssertNil(state.block(for: grace))
        XCTAssertTrue(state.allowsSend(for: grace))
        XCTAssertNil(state.block(for: nil))
        state.record(block, for: nil)
        XCTAssertNil(state.block)
    }
}
