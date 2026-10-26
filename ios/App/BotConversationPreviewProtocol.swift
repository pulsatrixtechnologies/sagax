#if DEBUG
import Foundation

/// Offline UI fixture for the read-only bot-to-bot page: serves the exchange's
/// thread from a bundled file and refuses everything else.
final class BotConversationPreviewProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard request.httpMethod == "GET",
              request.url?.path == "/api/threads/melonie-ask/messages",
              let url = Bundle.main.url(forResource: "BotConversationThread", withExtension: "json"),
              let data = try? Data(contentsOf: url) else {
            client?.urlProtocol(self, didFailWithError: URLError(.resourceUnavailable))
            return
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
#endif
