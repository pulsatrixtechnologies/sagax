// Record cards (#4572): the card of one record, and the product list that says
// which records the person may open. Both are read as the signed-in person;
// nothing in a request names anyone else.
import Foundation

extension CompanionClient {
    /// `GET /api/me/records/:product/:kind/:id?lang=`: a card, or the state that
    /// says why there is none. The card reads at once, with no confirmation.
    public func recordCard(_ ref: RecordRef, language: String, fresh: Bool = false) async throws -> RecordCardAnswer {
        // product, kind and id are `[A-Za-z0-9._:-]` (RecordLinks): nothing to encode
        guard RecordLinks.validName(ref.product), RecordLinks.validName(ref.kind), RecordLinks.validId(ref.id) else { throw APIError.badURL }
        var query = [URLQueryItem(name: "lang", value: language.lowercased().hasPrefix("fr") ? "fr" : "en")]
        if fresh { query.append(URLQueryItem(name: "fresh", value: "1")) }
        var request = try makeRequest("GET", "/api/me/records/\(ref.product)/\(ref.kind)/\(ref.id)", query: query)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await perform(request)
        try Self.check(response, data)
        return RecordCardParser.parseAnswer(data: data)
    }

    /// `GET /api/me/perspicax/products`: the person's products with the kinds of record each describes.
    public func recordProducts(language: String) async throws -> RecordProducts {
        let request = try makeRequest("GET", "/api/me/perspicax/products")
        let (data, response) = try await perform(request)
        try Self.check(response, data)
        return RecordProducts.parse(try? JSONSerialization.jsonObject(with: data), language: language)
    }
}
