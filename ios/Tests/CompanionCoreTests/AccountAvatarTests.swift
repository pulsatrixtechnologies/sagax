// The person's own photo (home, Settings account card, Account, Switch
// Account): what `GET /api/auth/session` names, how the phone asks its own
// server for it, and that nothing else becomes a request. Payloads are the
// shapes server/index.ts answers (sessionPersonFields, computerOwnerFields)
// and server/org/org-profile.e2e.test.ts pins.
import Foundation
import XCTest
@testable import CompanionCore

private final class AvatarStub: URLProtocol {
    static var responseBody = Data()
    static var statusCode = 200
    static var contentType = "image/png"
    static var captured: URLRequest?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.captured = request
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.statusCode, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": Self.contentType, "Cache-Control": "private, max-age=86400"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class AccountAvatarTests: XCTestCase {
    private static let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) + Data("body".utf8)
    private var session: URLSession!

    override func setUp() {
        super.setUp()
        AvatarStub.captured = nil
        AvatarStub.statusCode = 200
        AvatarStub.contentType = "image/png"
        AvatarStub.responseBody = Self.png
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AvatarStub.self]
        session = URLSession(configuration: configuration)
    }

    override func tearDown() {
        session.invalidateAndCancel()
        session = nil
        super.tearDown()
    }

    private func client() -> CompanionClient {
        CompanionClient(connection: Connection(name: "Example", host: "127.0.0.1", port: 8799), token: "phone-bearer", session: session)
    }

    // MARK: What the session names

    func testAnOrganizationSessionNamesThePersonsVersionedAvatar() throws {
        let json = #"""
        {"kind":"session","id":"sess_1","label":"Owner's iPhone","scopes":["client"],"via":"bearer","environmentId":"env",
         "identity":"perspicax","principalId":"pr_0b1c2d3e-0000-4000-8000-000000000001","email":"owner@example.test",
         "name":"Alex Martin","login":"amartin","role":"admin","teams":[],
         "profileManagedBy":"perspicax","profileManageUrl":"https://px.example.test/console/me",
         "avatarUrl":"/api/people/pr_0b1c2d3e-0000-4000-8000-000000000001/avatar?v=0123456789abcdef"}
        """#
        let auth = try JSONDecoder().decode(AuthSession.self, from: Data(json.utf8))
        XCTAssertEqual(auth.avatar?.route, .person(id: "pr_0b1c2d3e-0000-4000-8000-000000000001", version: "0123456789abcdef"))
        let identity = try JSONDecoder().decode(AccountIdentity.self, from: Data(json.utf8))
        XCTAssertEqual(identity.avatar, auth.avatar)
        XCTAssertEqual(identity.displayName(fallback: "x"), "Alex Martin")
    }

    func testAPersonalComputerNamesNoPhoto() throws {
        // Through the companion sidecar: loopback, the owner's name and the
        // computer's, no avatar (a personal computer has no Perspicax link).
        let json = #"{"kind":"loopback","scopes":["admin","client"],"environmentId":"env","name":"Owner","computerName":"Studio"}"#
        XCTAssertNil(try JSONDecoder().decode(AuthSession.self, from: Data(json.utf8)).avatar)
        XCTAssertNil(try JSONDecoder().decode(AccountIdentity.self, from: Data(json.utf8)).avatar)
    }

    func testAPictureClaimIsNeverAPhotoToFetch() throws {
        let json = #"{"kind":"session","scopes":["client"],"picture":"https://px.example.test/api/v1/pulsabot/people/01J9/avatar?v=0123456789abcdef"}"#
        XCTAssertNil(try JSONDecoder().decode(AuthSession.self, from: Data(json.utf8)).avatar)
        XCTAssertNil(try JSONDecoder().decode(AccountIdentity.self, from: Data(json.utf8)).avatar)
    }

    // MARK: Parsing

    func testParsesTheTwoRoutesTheServerServes() {
        XCTAssertEqual(AccountAvatar("/api/people/pr_1/avatar?v=abc_DEF-9")?.route, .person(id: "pr_1", version: "abc_DEF-9"))
        XCTAssertEqual(AccountAvatar(" /api/attachments/a1-b2.png ")?.route, .attachment(name: "a1-b2.png"))
    }

    func testRefusesAnythingElse() {
        for raw in [
            nil, "", " ",
            "https://px.example.test/api/v1/pulsabot/people/01J9/avatar?v=1",
            "http://127.0.0.1:8799/api/people/pr_1/avatar?v=1",
            "//evil.example/api/people/pr_1/avatar?v=1",
            "/api/people/pr_1/avatar",                 // unversioned: no cache key
            "/api/people/pr_1/avatar?v=",
            "/api/people/pr_1/avatar?v=1&x=2",
            "/api/people/pr_1/avatar?x=1",
            "/api/people/pr_1/avatar?v=a.b",
            "/api/people/../config/avatar?v=1",
            "/api/people/pr%2F1/avatar?v=1",
            "/api/people/pr_1/avatar/extra?v=1",
            "/api/people//avatar?v=1",
            "/api/people/\(String(repeating: "a", count: 81))/avatar?v=1",
            "/api/people/pr_1/avatar?v=\(String(repeating: "a", count: 65))",
            "/api/attachments/../config.json",
            "/api/attachments/a.svg",
            "/api/config",
        ] {
            XCTAssertNil(AccountAvatar(raw), String(describing: raw))
        }
    }

    func testANewVersionIsANewCacheKey() throws {
        let one = try XCTUnwrap(AccountAvatar("/api/people/pr_1/avatar?v=1111"))
        let two = try XCTUnwrap(AccountAvatar("/api/people/pr_1/avatar?v=2222"))
        XCTAssertNotEqual(one.cacheKey, two.cacheKey)
        XCTAssertEqual(one.cacheKey, AccountAvatar("/api/people/pr_1/avatar?v=1111")?.cacheKey)
        XCTAssertNotEqual(one.cacheKey, AccountAvatar("/api/people/pr_2/avatar?v=1111")?.cacheKey)
    }

    // MARK: The request

    func testAsksItsOwnServerWithItsBearerAndTheVersion() async throws {
        let avatar = try XCTUnwrap(AccountAvatar("/api/people/pr_1/avatar?v=0123456789abcdef"))
        let data = try await client().accountAvatar(avatar)
        XCTAssertEqual(data, Self.png)
        let request = try XCTUnwrap(AvatarStub.captured)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:8799/api/people/pr_1/avatar?v=0123456789abcdef")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer phone-bearer")
    }

    func testAStoredPictureUsesTheAttachmentRoute() async throws {
        AvatarStub.responseBody = Data([0xFF, 0xD8, 0xFF, 0xE0]) + Data("jpeg".utf8)
        AvatarStub.contentType = "image/jpeg"
        _ = try await client().accountAvatar(try XCTUnwrap(AccountAvatar("/api/attachments/me.jpg")))
        XCTAssertEqual(AvatarStub.captured?.url?.absoluteString, "http://127.0.0.1:8799/api/attachments/me.jpg")
    }

    func testARefusalOrANonImageThrows() async throws {
        let avatar = try XCTUnwrap(AccountAvatar("/api/people/pr_1/avatar?v=1"))
        AvatarStub.statusCode = 404
        AvatarStub.contentType = "application/json"
        AvatarStub.responseBody = Data(#"{"error":"no avatar"}"#.utf8)
        do {
            _ = try await client().accountAvatar(avatar)
            XCTFail("a 404 is not a photo")
        } catch let APIError.status(code, message) {
            XCTAssertEqual(code, 404)
            XCTAssertEqual(message, "no avatar")
        }
        AvatarStub.statusCode = 200
        AvatarStub.contentType = "text/html"
        AvatarStub.responseBody = Data("<html>".utf8)
        do {
            _ = try await client().accountAvatar(avatar)
            XCTFail("HTML is not a photo")
        } catch {}
    }
}
