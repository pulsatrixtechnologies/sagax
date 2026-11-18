#if DEBUG
import Foundation

/// Offline UI fixture for the record cards (`-record-cards-preview`): serves the
/// person's products and the card of each record from a bundled file, in the
/// language asked, as the server's route does; refuses everything else.
final class RecordCardPreviewProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard request.httpMethod == "GET", let url = request.url,
              let file = Bundle.main.url(forResource: "RecordCardPreviewData", withExtension: "json"),
              let data = try? Data(contentsOf: file),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return fail() }
        var body: Any?
        if url.path == "/api/me/perspicax/products" {
            body = root["products"]
        } else if url.path.hasPrefix("/api/me/records/") {
            let key = String(url.path.dropFirst("/api/me/records/".count))
            let language = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "lang" }?.value ?? "en"
            let variants = (root["cards"] as? [String: Any])?[key] as? [String: Any]
            if let card = variants?[language] ?? variants?["en"] {
                body = ["card": card]
            } else {
                body = ["state": "unknown"]
            }
        }
        guard let body, let out = try? JSONSerialization.data(withJSONObject: body) else { return fail() }
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: out)
        client?.urlProtocolDidFinishLoading(self)
    }

    private func fail() {
        client?.urlProtocol(self, didFailWithError: URLError(.resourceUnavailable))
    }

    override func stopLoading() {}
}
#endif
