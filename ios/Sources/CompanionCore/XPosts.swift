// X (Twitter) cards in the chat (#4638), ported from `shared/x-post.ts` so both
// clients read the same fences the same way:
//   ```x-post   a draft: JSON {"text","name"?,"handle"?,"avatarUrl"?} or the bare text
//   ```x-posts  what an X tool returned: {"posts":[...]} or an array, with the
//               card's own fields or the X API v2 names (public_metrics, author, includes)
import Foundation

public let xPostLimit = 280
public let xPostCounterFrom = 20

public enum XDraftAction: String, Sendable { case post, discard }

public struct XDraftReceipt: Decodable, Sendable { public var status: String? }

public struct XDraftState: Decodable, Equatable, Sendable {
    public var status: String
    public var text: String?
    public var url: String?
    public var error: String?
}

struct XDraftStateEnvelope: Decodable { var post: XDraftState? }

public struct XDraft: Equatable, Sendable {
    public var text: String
    public var name: String?
    public var handle: String?
    public var avatarUrl: String?
}

public struct XMedia: Equatable, Sendable {
    public var type: String
    public var url: String
    public var previewUrl: String?
    public var alt: String?
}

public struct XMetrics: Equatable, Sendable {
    public var replies: Int?
    public var reposts: Int?
    public var likes: Int?
    public var views: Int?
    public var bookmarks: Int?
}

public final class XPost: Equatable, Identifiable, @unchecked Sendable {
    public let id: String
    public let url: String?
    public let name: String
    public let handle: String
    public let verified: Bool
    public let avatarUrl: String?
    public let createdAt: String?
    public let text: String
    public let media: [XMedia]
    public let quoted: XPost?
    public let metrics: XMetrics?

    init(id: String, url: String?, name: String, handle: String, verified: Bool, avatarUrl: String?, createdAt: String?, text: String, media: [XMedia], quoted: XPost?, metrics: XMetrics?) {
        self.id = id; self.url = url; self.name = name; self.handle = handle; self.verified = verified
        self.avatarUrl = avatarUrl; self.createdAt = createdAt; self.text = text; self.media = media
        self.quoted = quoted; self.metrics = metrics
    }

    public static func == (left: XPost, right: XPost) -> Bool {
        left.id == right.id && left.text == right.text && left.handle == right.handle && left.metrics == right.metrics && left.quoted == right.quoted
    }
}

public enum XPosts {
    // MARK: Counting

    /// A link counts 23, a wide letter or an emoji 2, the rest 1.
    public static func weightedLength(_ text: String) -> Int {
        var total = 0
        var bare = ""
        let nsText = text as NSString
        let regex = try! NSRegularExpression(pattern: #"https?://\S+"#, options: [.caseInsensitive])
        var cursor = 0
        for match in regex.matches(in: text, range: NSRange(location: 0, length: nsText.length)) {
            bare += nsText.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            cursor = match.range.location + match.range.length
            total += 23
        }
        bare += nsText.substring(from: cursor)
        for scalar in bare.precomposedStringWithCanonicalMapping.unicodeScalars {
            total += isWide(scalar) ? 2 : 1
        }
        return total
    }

    private static func isWide(_ scalar: Unicode.Scalar) -> Bool {
        let value = scalar.value
        if scalar.properties.isEmojiPresentation || (scalar.properties.isEmoji && value > 0x2000 && value != 0x2122) { return true }
        return (0x1100...0x115f).contains(value) || (0x2e80...0x303e).contains(value) || (0x3041...0x33ff).contains(value)
            || (0x3400...0x4dbf).contains(value) || (0x4e00...0x9fff).contains(value) || (0xa000...0xa4cf).contains(value)
            || (0xac00...0xd7a3).contains(value) || (0xf900...0xfaff).contains(value) || (0xfe30...0xfe4f).contains(value)
            || (0xff00...0xff60).contains(value) || (0xffe0...0xffe6).contains(value)
    }

    public static func counter(_ text: String) -> (used: Int, remaining: Int, over: Bool, show: Bool) {
        let used = weightedLength(text)
        let remaining = xPostLimit - used
        return (used, remaining, remaining < 0, remaining <= xPostCounterFrom)
    }

    /// The text as it will be posted: line endings and the space around it folded.
    public static func postText(_ text: String) -> String {
        var out = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        out = out.replacingOccurrences(of: #"[ \t]+\n"#, with: "\n", options: .regularExpression)
        out = out.replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// FNV-1a of the text as the bot wrote it (the same key as `xDraftKey`).
    public static func draftKey(_ text: String) -> String {
        var hash: UInt32 = 0x811c9dc5
        for unit in postText(text).utf16 {
            hash ^= UInt32(unit)
            hash = hash &* 0x01000193
        }
        return String(format: "%08x", hash)
    }

    /// 1,234, 12.3K, 4.5M: X's own short counts.
    public static func shortCount(_ value: Int, french: Bool = false) -> String {
        func short(_ divisor: Double, _ suffix: String) -> String {
            let scaled = Double(value) / divisor
            let text = String(format: scaled >= 100 ? "%.0f" : "%.1f", scaled)
            let trimmed = text.hasSuffix(".0") ? String(text.dropLast(2)) : text
            return french ? trimmed.replacingOccurrences(of: ".", with: ",") + " " + (suffix == "K" ? "k" : suffix) : trimmed + suffix
        }
        if value >= 1_000_000 { return short(1_000_000, "M") }
        if value >= 10_000 { return short(1_000, "K") }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: french ? "fr_CA" : "en_US")
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// Only X's own CDN loads without asking.
    public static func isXMediaHost(_ url: String?) -> Bool {
        guard let url, let host = URL(string: url)?.host?.lowercased() else { return false }
        return ["pbs.twimg.com", "abs.twimg.com", "video.twimg.com", "ton.twitter.com"].contains(host)
    }

    // MARK: Reading

    public static func parseDraft(_ code: String) -> XDraft? {
        let trimmed = postText(code)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.hasPrefix("{"), let row = object(trimmed), let text = string(row["text"]) {
            return XDraft(text: postText(text), name: string(row["name"]).map { String($0.prefix(80)) },
                          handle: handle(row["handle"]), avatarUrl: httpsUrl(row["avatarUrl"] ?? row["avatar"]))
        }
        return XDraft(text: trimmed, name: nil, handle: nil, avatarUrl: nil)
    }

    public static func parsePosts(_ code: String) -> [XPost]? {
        guard let data = code.data(using: .utf8), let parsed = try? JSONSerialization.jsonObject(with: data) else { return nil }
        var includes: [String: Any] = [:]
        var list: [Any] = []
        if let array = parsed as? [Any] {
            list = array
        } else if let row = parsed as? [String: Any] {
            includes = row["includes"] as? [String: Any] ?? [:]
            if let found = ["posts", "data", "tweets", "results"].lazy.compactMap({ row[$0] as? [Any] }).first { list = found }
            else if let single = row["data"] as? [String: Any] { list = [single] }
            else { list = [row] }
        }
        let posts = list.prefix(50).compactMap { readPost($0, includes: includes, depth: 0) }
        return posts.isEmpty ? nil : posts
    }

    static func readPost(_ value: Any, includes: [String: Any], depth: Int) -> XPost? {
        guard let row = value as? [String: Any], depth <= 1 else { return nil }
        let users = (includes["users"] as? [[String: Any]]) ?? []
        let author = (row["author"] as? [String: Any]) ?? (row["user"] as? [String: Any])
            ?? users.first { row["author_id"] != nil && string($0["id"]) == string(row["author_id"]) }
        guard let handle = handle(row["handle"] ?? row["username"] ?? row["screen_name"] ?? author?["username"] ?? author?["handle"] ?? author?["screen_name"]),
              let body = (row["text"] as? String) ?? (row["full_text"] as? String), !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return nil }
        let id = string(row["id"] ?? row["id_str"] ?? row["rest_id"] ?? row["tweet_id"])
        let stated = siteUrl(row["url"])
        let url = stated ?? (id.flatMap { $0.range(of: #"^\d{5,25}$"#, options: .regularExpression) != nil ? "https://x.com/\(handle)/status/\($0)" : nil })
        var media: [XMedia] = []
        var rawMedia = row["media"] as? [[String: Any]] ?? []
        if rawMedia.isEmpty, let keys = (row["attachments"] as? [String: Any])?["media_keys"] as? [Any] {
            let wanted = Set(keys.compactMap { string($0) })
            rawMedia = ((includes["media"] as? [[String: Any]]) ?? []).filter { wanted.contains(string($0["media_key"]) ?? "") }
        }
        for item in rawMedia.prefix(4) {
            let kind = string(item["type"])?.lowercased()
            let type = kind == "video" ? "video" : (kind == "animated_gif" || kind == "gif") ? "gif" : "photo"
            let preview = httpsUrl(item["previewUrl"] ?? item["preview_image_url"] ?? item["media_url_https"])
            guard let url = httpsUrl(item["url"] ?? item["media_url_https"] ?? item["src"]) ?? preview else { continue }
            media.append(XMedia(type: type, url: url, previewUrl: preview == url ? nil : preview, alt: string(item["alt"] ?? item["alt_text"]).map { String($0.prefix(300)) }))
        }
        var quotedRaw: Any? = row["quoted"] ?? row["quoted_post"] ?? row["quoted_tweet"]
        if quotedRaw == nil, let refs = row["referenced_tweets"] as? [[String: Any]],
           let ref = refs.first(where: { string($0["type"]) == "quoted" }) {
            quotedRaw = ((includes["tweets"] as? [[String: Any]]) ?? []).first { string($0["id"]) == string(ref["id"]) }
        }
        let quoted = quotedRaw.flatMap { readPost($0, includes: includes, depth: depth + 1) }
        let name = string(row["name"] ?? row["displayName"] ?? row["display_name"] ?? author?["name"] ?? author?["displayName"]) ?? handle
        let verifiedType = string(row["verified_type"] ?? author?["verified_type"])
        let verified = (row["verified"] as? Bool) ?? (row["is_blue_verified"] as? Bool) ?? (author?["verified"] as? Bool)
            ?? (author?["is_blue_verified"] as? Bool) ?? (verifiedType != nil && verifiedType != "none")
        let metricSource = (row["metrics"] as? [String: Any]) ?? (row["public_metrics"] as? [String: Any]) ?? (row["stats"] as? [String: Any]) ?? row
        var metrics = XMetrics()
        metrics.replies = int(metricSource["replies"] ?? metricSource["reply_count"] ?? metricSource["replyCount"])
        metrics.reposts = int(metricSource["reposts"] ?? metricSource["retweet_count"] ?? metricSource["retweets"] ?? metricSource["repost_count"])
        metrics.likes = int(metricSource["likes"] ?? metricSource["like_count"] ?? metricSource["favorite_count"] ?? metricSource["favorites"])
        metrics.views = int(metricSource["views"] ?? metricSource["impression_count"] ?? metricSource["view_count"] ?? metricSource["impressions"])
        metrics.bookmarks = int(metricSource["bookmarks"] ?? metricSource["bookmark_count"])
        let hasMetrics = metrics.replies != nil || metrics.reposts != nil || metrics.likes != nil || metrics.views != nil || metrics.bookmarks != nil
        return XPost(
            id: id ?? "\(handle)-\(body.hashValue)", url: url, name: String(name.prefix(80)), handle: handle, verified: verified,
            avatarUrl: httpsUrl(row["avatarUrl"] ?? row["avatar"] ?? row["profile_image_url"] ?? author?["avatarUrl"] ?? author?["profile_image_url"] ?? author?["profile_image_url_https"]),
            createdAt: string(row["createdAt"] ?? row["created_at"] ?? row["date"]),
            text: String(body.replacingOccurrences(of: "\r\n", with: "\n").trimmingCharacters(in: .whitespacesAndNewlines).prefix(4000)),
            media: media, quoted: quoted, metrics: hasMetrics ? metrics : nil
        )
    }

    // MARK: Small readers

    private static func object(_ text: String) -> [String: Any]? {
        guard let data = text.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private static func string(_ value: Any?) -> String? {
        if let text = value as? String { let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines); return trimmed.isEmpty ? nil : trimmed }
        if let number = value as? NSNumber, !(value is Bool) { return number.stringValue }
        return nil
    }

    private static func int(_ value: Any?) -> Int? {
        if let number = value as? NSNumber, !(value is Bool), number.doubleValue >= 0 { return Int(number.doubleValue) }
        if let text = value as? String, let parsed = Double(text.trimmingCharacters(in: .whitespaces)), parsed >= 0 { return Int(parsed) }
        return nil
    }

    private static func handle(_ value: Any?) -> String? {
        guard var raw = string(value) else { return nil }
        if raw.hasPrefix("@") { raw.removeFirst() }
        return raw.range(of: #"^[A-Za-z0-9_]{1,15}$"#, options: .regularExpression) != nil ? raw : nil
    }

    public static func httpsUrl(_ value: Any?) -> String? {
        guard let raw = string(value), let url = URL(string: raw), url.scheme?.lowercased() == "https", url.host != nil else { return nil }
        return url.absoluteString
    }

    static func siteUrl(_ value: Any?) -> String? {
        guard let url = httpsUrl(value), let host = URL(string: url)?.host?.lowercased() else { return nil }
        return ["x.com", "twitter.com", "www.x.com", "www.twitter.com", "mobile.twitter.com"].contains(host) ? url : nil
    }
}
