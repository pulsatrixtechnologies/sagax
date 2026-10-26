// Settings, Account, Bot Computer and Plugins (iOS parity 12, 14, 15, 16,
// 21). Payloads are written in the shapes server/routes/bot-settings.ts,
// auto-review-rules.ts, computer-status.ts, plugins.ts and account.ts return.
import Foundation
import XCTest
@testable import CompanionCore

private final class SettingsStub: URLProtocol {
    static var responseBody = Data()
    static var statusCode = 200
    static var captured: URLRequest?
    static var capturedBody: Data?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.captured = request
        Self.capturedBody = request.httpBody ?? request.httpBodyStream.map { stream in
            stream.open()
            defer { stream.close() }
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 1_024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            return data
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.statusCode, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class SettingsClientTests: XCTestCase {
    private var session: URLSession!

    override func setUp() {
        super.setUp()
        SettingsStub.captured = nil
        SettingsStub.capturedBody = nil
        SettingsStub.statusCode = 200
        SettingsStub.responseBody = Data("{}".utf8)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SettingsStub.self]
        session = URLSession(configuration: configuration)
    }

    override func tearDown() {
        session.invalidateAndCancel()
        session = nil
        super.tearDown()
    }

    private func client(_ connection: Connection = Connection(name: "Mac", host: "127.0.0.1", port: 8810)) -> CompanionClient {
        CompanionClient(connection: connection, token: "paired-token", session: session)
    }

    private func respond(_ json: String, status: Int = 200) {
        SettingsStub.responseBody = Data(json.utf8)
        SettingsStub.statusCode = status
    }

    private func body() throws -> [String: Any] {
        let data = try XCTUnwrap(SettingsStub.capturedBody)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    // MARK: Account

    func testAccountIdentityOfAPersonalComputerShowsOwnerAndComputer() async throws {
        respond(#"{"kind":"loopback","scopes":["admin"],"environmentId":"env","name":"JC","computerName":"Studio"}"#)
        let identity = try await client().accountIdentity()
        XCTAssertEqual(identity.displayName(fallback: "x"), "JC")
        XCTAssertEqual(identity.detail, "Studio")
        XCTAssertEqual(SettingsStub.captured?.url?.path, "/api/auth/session")
    }

    func testAccountIdentityOfAnOrganizationPersonShowsEmailAndPhoto() async throws {
        respond(#"{"kind":"session","id":"s","scopes":["client"],"email":"ada@example.com","name":"Ada","avatarUrl":" /api/attachments/a.png "}"#)
        let identity = try await client().accountIdentity()
        XCTAssertEqual(identity.detail, "ada@example.com")
        XCTAssertEqual(identity.avatarUrl, "/api/attachments/a.png")
        XCTAssertEqual(AccountIdentity().displayName(fallback: "Parity fixture"), "Parity fixture")
    }

    func testDeleteAccountSendsTheConfirmationAndMapsEachAnswer() async throws {
        respond(#"{"deleted":true,"bots":1,"threads":2}"#)
        let deleted = try await client().deleteAccount()
        XCTAssertEqual(deleted, .deleted)
        XCTAssertEqual(SettingsStub.captured?.httpMethod, "DELETE")
        XCTAssertEqual(SettingsStub.captured?.url?.path, "/api/me")
        XCTAssertEqual(try body()["confirm"] as? Bool, true)

        respond(#"{"error":"This is a personal computer.","code":"personal_server"}"#, status: 400)
        let personal = try await client().deleteAccount()
        XCTAssertEqual(personal, .personalServer)

        respond(#"{"error":"Ask your administrator.","code":"perspicax_deletion_unavailable"}"#, status: 501)
        let unavailable = try await client().deleteAccount()
        XCTAssertEqual(unavailable, .unavailable("Ask your administrator."))

        respond(#"{"error":"Sign in with Pulsatrix to delete your account.","code":"identity_perspicax"}"#, status: 403)
        do {
            _ = try await client().deleteAccount()
            XCTFail("a 403 is an error")
        } catch let APIError.status(code, message) {
            XCTAssertEqual(code, 403)
            XCTAssertEqual(message, "Sign in with Pulsatrix to delete your account.")
        }
    }

    func testDeleteAccountAsksToSignInAgainAndTheSheetStartIsTheServersOwn() async throws {
        respond(#"{"error":"Sign in again first.","code":"reauth_required","reauthPath":"/api/me/reauth"}"#, status: 409)
        let outcome = try await client().deleteAccount()
        XCTAssertEqual(outcome, .reauthRequired("Sign in again first."))

        respond(#"{"url":"https://sagax.example.test/auth/oidc/reauth?ticket=abc&client=phone","expiresAt":1}"#)
        let url = try await client().beginAccountReauth()
        XCTAssertEqual(url.absoluteString, "https://sagax.example.test/auth/oidc/reauth?ticket=abc&client=phone")
        XCTAssertEqual(SettingsStub.captured?.httpMethod, "POST")
        XCTAssertEqual(SettingsStub.captured?.url?.path, "/api/me/reauth")
        XCTAssertEqual(try body()["client"] as? String, "phone")

        // Never another page, nor plain http to another host.
        for bad in ["https://sagax.example.test/elsewhere", "http://evil.example.test/auth/oidc/reauth?ticket=a", "https://u:p@sagax.example.test/auth/oidc/reauth"] {
            respond(#"{"url":"\#(bad)"}"#)
            do {
                _ = try await client().beginAccountReauth()
                XCTFail("\(bad) is refused")
            } catch {}
        }
        let lan = URL(string: "http://127.0.0.1:8810/auth/oidc/reauth?ticket=a")!
        XCTAssertTrue(CompanionClient.isAccountReauthURL(lan, base: URL(string: "http://127.0.0.1:8810")))

        XCTAssertEqual(CompanionClient.accountReauthOutcome(URL(string: "sagax://account-reauth?address=x&status=ok")), .signedIn)
        XCTAssertEqual(CompanionClient.accountReauthOutcome(URL(string: "sagax://account-reauth?address=x&error=reauth_stale")), .failed("reauth_stale"))
        XCTAssertEqual(CompanionClient.accountReauthOutcome(URL(string: "sagax://pair?status=ok")), .failed(nil))
        XCTAssertEqual(CompanionClient.accountReauthOutcome(nil), .failed(nil))
    }

    // MARK: Bot settings

    func testBotSettingsDecodeAndShowTheEffectiveZone() async throws {
        respond(#"{"settings":{"autoReviewDefault":true,"timeZone":null,"timeZoneAuto":false},"scope":"server","hostTimeZone":"America/Toronto","effectiveTimeZone":"America/Toronto"}"#)
        let settings = try await client().botSettings()
        XCTAssertTrue(settings.settings.autoReviewDefault)
        XCTAssertNil(settings.settings.timeZone)
        XCTAssertEqual(settings.displayTimeZone, "America/Toronto")
    }

    func testUpdateBotSettingsSendsOnlyTheFieldsSet() async throws {
        respond(#"{"settings":{"autoReviewDefault":false,"timeZone":"Europe/Paris","timeZoneAuto":true},"scope":"server"}"#)
        let saved = try await client().updateBotSettings(BotSettingsPatch(timeZone: "Europe/Paris", timeZoneAuto: true))
        XCTAssertEqual(saved.settings.timeZone, "Europe/Paris")
        XCTAssertEqual(SettingsStub.captured?.httpMethod, "PUT")
        XCTAssertEqual(SettingsStub.captured?.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let sent = try body()
        XCTAssertEqual(Set(sent.keys), ["timeZone", "timeZoneAuto"])
        XCTAssertThrowsError(try client().updateBotSettingsRequest(BotSettingsPatch()))
    }

    func testAutoReviewRulesListAndDelete() async throws {
        let list = #"{"rules":[{"id":"cmd.bot-1.11111111-2222-4333-8444-555555555555","scope":"bot","botId":"bot-1","botName":"Ara","command":"git status","cwd":"/work","providerInstanceId":"claude"}],"global":[],"total":1}"#
        respond(list)
        let rules = try await client().autoReviewRules()
        XCTAssertEqual(rules.total, 1)
        XCTAssertEqual(rules.all.first?.botName, "Ara")

        respond(#"{"rules":[],"global":[],"total":0}"#)
        let after = try await client().deleteAutoReviewRule(id: "cmd.bot-1.11111111-2222-4333-8444-555555555555")
        XCTAssertEqual(after.total, 0)
        XCTAssertEqual(SettingsStub.captured?.httpMethod, "DELETE")
        XCTAssertEqual(SettingsStub.captured?.url?.path, "/api/auto-review/rules/cmd.bot-1.11111111-2222-4333-8444-555555555555")
        XCTAssertThrowsError(try client().deleteAutoReviewRuleRequest(id: "../etc"))
        XCTAssertThrowsError(try client().deleteAutoReviewRuleRequest(id: ""))
    }

    // MARK: Bot computer

    func testComputerStatusDecodesDiskStateAndUnknownValues() async throws {
        respond(#"{"kind":"org-sandbox","configured":true,"state":"running","diskState":"almostFull","workspaceBytes":95,"limitBytes":100}"#)
        let status = try await client().computerStatus()
        XCTAssertEqual(status.kind, .orgSandbox)
        XCTAssertEqual(status.diskState, .almostFull)
        respond(#"{"kind":"vm","configured":false,"state":"unavailable","diskState":"weird","workspaceBytes":null}"#)
        let odd = try await client().computerStatus()
        XCTAssertEqual(odd.kind, .unknown)
        XCTAssertEqual(odd.diskState, .normal)
    }

    func testUpdateAndResetPostJSONAndResetConfirms() async throws {
        respond(#"{"kind":"local","configured":true,"state":"running","diskState":"normal","workspaceBytes":1}"#)
        _ = try await client().updateComputer()
        XCTAssertEqual(SettingsStub.captured?.httpMethod, "POST")
        XCTAssertEqual(SettingsStub.captured?.url?.path, "/api/computer/update")
        XCTAssertEqual(SettingsStub.captured?.value(forHTTPHeaderField: "Content-Type"), "application/json")
        _ = try await client().resetComputer()
        XCTAssertEqual(SettingsStub.captured?.url?.path, "/api/computer/reset")
        XCTAssertEqual(try body()["confirm"] as? Bool, true)
    }

    // MARK: Plugins

    func testPluginSearchDecodesListingsAndSendsTheQuery() async throws {
        respond(#"{"featured":[{"id":"context7","name":"Context7","description":"Docs.","url":"https://mcp.context7.com/mcp","transport":"http","domain":"mcp.context7.com","auth":"none","source":"featured","reviewed":true,"icon":"context7","installed":false}],"results":[{"id":"registry:io.example/x","name":"X","description":"","url":"https://x.example/mcp","transport":"http","domain":"x.example","auth":"headers","source":"registry","reviewed":false,"installed":true}],"nextCursor":"c2","registryAvailable":true}"#)
        let page = try await client().searchPlugins(query: "  docs ", cursor: "c1")
        XCTAssertEqual(page.featured.first?.icon, "context7")
        XCTAssertEqual(page.results.first?.needsHeaders, true)
        XCTAssertEqual(page.results.first?.isCommunity, true)
        XCTAssertEqual(page.nextCursor, "c2")
        let query = URLComponents(url: try XCTUnwrap(SettingsStub.captured?.url), resolvingAgainstBaseURL: false)?.queryItems
        XCTAssertEqual(query, [URLQueryItem(name: "q", value: "docs"), URLQueryItem(name: "cursor", value: "c1")])
    }

    func testInstalledPluginsKeepReadableEntries() async throws {
        respond(#"{"plugins":[{"kind":"mcp","name":"deepwiki","url":"https://mcp.deepwiki.com/mcp","domain":"mcp.deepwiki.com","enabled":true,"auth":"none","icon":"deepwiki","catalogId":"deepwiki"},{"kind":"mcp","name":"notion","url":"https://mcp.notion.com/mcp","domain":"mcp.notion.com","enabled":true,"auth":"required"},{"kind":"mcp"}],"count":3}"#)
        let installed = try await client().installedPlugins()
        XCTAssertEqual(installed.plugins.count, 2)
        XCTAssertEqual(installed.count, 3)
        XCTAssertTrue(installed.plugins[0].isReady)
        XCTAssertTrue(installed.plugins[1].needsSignIn)
        XCTAssertEqual(installed.installedURLs, ["https://mcp.deepwiki.com/mcp", "https://mcp.notion.com/mcp"])
    }

    func testInstallSendsReturnToAndNoOriginOnALANComputer() async throws {
        respond(#"{"name":"notion","alreadyInstalled":false,"auth":"required","authorizationUrl":"https://mcp.notion.com/authorize?x=1"}"#)
        let result = try await client().installPlugin(id: "notion")
        XCTAssertTrue(result.needsSignIn)
        XCTAssertEqual(result.authorizationUrl?.host, "mcp.notion.com")
        let sent = try body()
        XCTAssertEqual(sent["id"] as? String, "notion")
        XCTAssertEqual(sent["returnTo"] as? String, "sagax://oauth-done")
        XCTAssertNil(sent["callbackOrigin"])
        XCTAssertNil(sent["trust"])
    }

    func testInstallThroughATailnetComputerSendsItsOrigin() async throws {
        respond(#"{"name":"linear","alreadyInstalled":true,"auth":"connected"}"#)
        let tailnet = Connection(
            name: "Studio",
            host: "studio.tail1234.ts.net",
            port: 8810,
            allowedTailnetHost: "studio.tail1234.ts.net"
        )
        let result = try await client(tailnet).installPlugin(id: "linear", trust: true)
        XCTAssertFalse(result.needsSignIn)
        let sent = try body()
        XCTAssertEqual(sent["callbackOrigin"] as? String, "http://studio.tail1234.ts.net:8810")
        XCTAssertEqual(sent["trust"] as? Bool, true)
    }

    func testInstallReportsAServerThatCouldNotStartTheSignIn() throws {
        let data = Data(#"{"name":"notion","alreadyInstalled":false,"auth":"required","signIn":{"error":"Send the address.","code":"callback_unreachable"}}"#.utf8)
        let result = try JSONDecoder().decode(PluginInstallResult.self, from: data)
        XCTAssertNil(result.authorizationUrl)
        XCTAssertEqual(result.signInError, "Send the address.")
    }

    func testCallbackOriginRules() {
        XCTAssertNil(PluginSignIn.callbackOrigin(for: Connection(name: "LAN", host: "192.168.1.4", port: 8810)))
        let hosted = Connection.parse("https://studio.example.com")!
        XCTAssertEqual(PluginSignIn.callbackOrigin(for: hosted), "https://studio.example.com")
        var server = hosted
        server.serverEnvironmentId = "env"
        XCTAssertNil(PluginSignIn.callbackOrigin(for: server), "a server uses its own public address")
    }

    func testStartSignInForAnAddedServer() async throws {
        respond(#"{"authorizationUrl":"https://auth.example/authorize"}"#)
        let url = try await client().startPluginSignIn(serverName: "bookstack")
        XCTAssertEqual(url.host, "auth.example")
        XCTAssertEqual(SettingsStub.captured?.url?.path, "/api/mcp/servers/bookstack/oauth/start")
        XCTAssertEqual(try body()["returnTo"] as? String, "sagax://oauth-done")
        XCTAssertThrowsError(try client().startPluginSignInRequest(serverName: "a/b"))
    }

    func testSignInOutcomeAndFilter() {
        XCTAssertEqual(PluginSignIn.outcome(of: URL(string: "sagax://oauth-done?status=ok&server=notion")!), .ok(server: "notion"))
        XCTAssertEqual(PluginSignIn.outcome(of: URL(string: "sagax://oauth-done?status=error&error=denied")!), .failed("denied"))
        XCTAssertTrue(PluginFilter.all.admits(installed: false))
        XCTAssertTrue(PluginFilter.installed.admits(installed: true))
        XCTAssertFalse(PluginFilter.notInstalled.admits(installed: true))
    }
}
