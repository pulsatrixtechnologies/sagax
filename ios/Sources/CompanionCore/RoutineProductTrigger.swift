// "When something changes in a product" (#4250), the phone's side of the
// desktop's ProductTriggerFields (src/components/routines/ProductTriggerFields.tsx):
// what the viewer can watch, as Perspicax lists it
// (GET /api/bots/:id/watchable-resources), offered beside the free field.
// The schedule itself is RoutineScheduleForm's (`.product`).
import Foundation

/// One entry the viewer can watch. A template has a `{...}` part to fill in
/// the field.
public struct WatchableResource: Hashable, Sendable, Identifiable {
    public var uri: String
    public var name: String?
    public var template: Bool

    public var id: String { uri }
    /// What a suggestion shows: its name, else the URI.
    public var label: String { name ?? uri }

    public init(uri: String, name: String? = nil, template: Bool = false) {
        self.uri = uri
        self.name = name
        self.template = template
    }

    /// The desktop's watchableFrom: the route's answer when it is available,
    /// only `perspicax://` URIs, else nothing.
    public static func list(from data: Data) -> [WatchableResource] {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["available"] as? Bool == true,
              let resources = object["resources"] as? [Any] else { return [] }
        return resources.compactMap { entry in
            guard let entry = entry as? [String: Any], let uri = entry["uri"] as? String,
                  uri.lowercased().hasPrefix(RoutineScheduleForm.productResourcePrefix) else { return nil }
            let name = (entry["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            return WatchableResource(uri: uri, name: name?.isEmpty == false ? name : nil, template: entry["template"] as? Bool == true)
        }
    }
}

public extension RoutineScheduleForm {
    /// A suggestion tapped: its URI in the field, once.
    mutating func addProductResource(_ uri: String) {
        let current = Self.productURIs(productResources)
        guard !current.contains(uri) else { return }
        productResources = (current + [uri]).joined(separator: "\n")
    }
}

public extension CompanionClient {
    /// What the viewer can watch in their products, read with their own
    /// sign-in (`GET /api/bots/:id/watchable-resources`). Empty on a solo
    /// server or when Perspicax cannot be read.
    func watchableResources(botId: String) async throws -> [WatchableResource] {
        let (data, response) = try await perform(try makeRequest("GET", "/api/bots/\(botId)/watchable-resources"))
        try Self.check(response, data)
        return WatchableResource.list(from: data)
    }
}
