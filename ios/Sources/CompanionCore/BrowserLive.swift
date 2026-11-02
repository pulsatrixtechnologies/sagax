// The bot's live browser, watched from the phone (browser mode of the
// Computer tab; the desktop's LiveBrowser, src/components/BrowserPanel.tsx).
// The stream is `GET /api/bots/:id/browser/live` (server/browser/browser-live.ts):
// `event: <type>` lines with a JSON body. Each frame is acknowledged with
// `POST /api/bots/:id/browser/action {viewerId, type: "ack", seq}`, which is
// what lets the next one come. The Computer tab's card watches a preview
// (`?preview=1`: no launch, 5 fps, acknowledgements only); Take control opens
// the full stream in a modal, where the person can drive the page
// (`BrowserLiveAction`), like the desktop's SandboxDesktopModal kind browser.
import Foundation

/// One tab of the bot's browser, as the stream lists it.
public struct BrowserLiveTab: Equatable, Sendable {
    public var tabId: String
    public var title: String
    public var url: String
    public var active: Bool
}

/// What the live browser stream says, already understood.
public enum BrowserLiveMessage: Equatable, Sendable {
    /// The view is open; `viewerId` names this viewer in its actions.
    case ready(viewerId: String)
    /// The browser is busy with the bot's own command, or starting.
    case waiting(reason: String?)
    /// A JPEG or PNG frame of the page, and the page's size in pixels.
    case frame(seq: Int, image: Data, width: Int, height: Int)
    case url(String)
    case tabs([BrowserLiveTab])
    case status(connected: Bool)
    /// Who holds the browser: `owned` is this viewer, `controlling` means its
    /// input goes through now.
    case control(held: Bool, owned: Bool, controlling: Bool)
    /// A preview found no running browser: it is never launched just to be
    /// watched. The stream ends after this.
    case offline
    case error(message: String, retryable: Bool)
    case heartbeat

    /// One SSE event of the stream, or nil for anything this build does not
    /// read (control, a malformed body).
    public static func parse(event: String?, data: String) -> BrowserLiveMessage? {
        guard let event,
              let raw = data.data(using: .utf8),
              let body = (try? JSONSerialization.jsonObject(with: raw)) as? [String: Any]
        else { return nil }
        switch event {
        case "ready":
            guard let viewer = body["viewerId"] as? String, !viewer.isEmpty else { return nil }
            return .ready(viewerId: viewer)
        case "waiting":
            return .waiting(reason: body["reason"] as? String)
        case "frame":
            guard let seq = (body["seq"] as? NSNumber)?.intValue, seq > 0,
                  let text = body["data"] as? String,
                  let image = Data(base64Encoded: text), !image.isEmpty
            else { return nil }
            let meta = body["metadata"] as? [String: Any]
            let width = (meta?["deviceWidth"] as? NSNumber)?.intValue ?? 1280
            let height = (meta?["deviceHeight"] as? NSNumber)?.intValue ?? 720
            return .frame(seq: seq, image: image, width: width, height: height)
        case "url":
            return .url(body["url"] as? String ?? "")
        case "tabs":
            let tabs = (body["tabs"] as? [[String: Any]] ?? []).compactMap { tab -> BrowserLiveTab? in
                guard let id = tab["tabId"] as? String else { return nil }
                return BrowserLiveTab(tabId: id, title: tab["title"] as? String ?? "", url: tab["url"] as? String ?? "",
                                      active: tab["active"] as? Bool ?? false)
            }
            return .tabs(tabs)
        case "status":
            guard let connected = body["connected"] as? Bool else { return nil }
            return .status(connected: connected)
        case "error":
            return .error(message: body["message"] as? String ?? "The browser stream was interrupted.",
                          retryable: body["retryable"] as? Bool ?? true)
        case "heartbeat":
            return .heartbeat
        case "control":
            guard let held = body["held"] as? Bool else { return nil }
            return .control(held: held, owned: body["owned"] as? Bool ?? false,
                            controlling: body["controlling"] as? Bool ?? false)
        case "offline":
            return .offline
        default:
            return nil
        }
    }
}

/// What the browser view shows, folded from the stream.
public struct BrowserLiveState: Equatable, Sendable {
    public var viewerId: String?
    public var image: Data?
    public var size = BrowserPageSize(width: 1280, height: 720)
    public var url = ""
    public var title = ""
    public var waiting = false
    public var error: String?
    /// A preview was told the browser is closed.
    public var offline = false
    /// Someone holds the browser, this viewer or another.
    public var held = false
    /// This viewer holds the browser.
    public var owned = false
    /// This viewer's input goes through now.
    public var controlling = false

    public init() {}

    /// The latest frame's number, for its acknowledgement.
    public private(set) var lastSeq: Int?

    /// Applies one message; returns the frame number to acknowledge, if any.
    public mutating func apply(_ message: BrowserLiveMessage) -> Int? {
        switch message {
        case let .ready(viewer):
            viewerId = viewer
            waiting = false
            error = nil
        case .waiting:
            waiting = true
        case let .frame(seq, data, width, height):
            image = data
            size = BrowserPageSize(width: width, height: height)
            waiting = false
            error = nil
            lastSeq = seq
            return seq
        case let .url(value):
            url = value
        case let .tabs(tabs):
            if let active = tabs.first(where: \.active) ?? tabs.first {
                title = active.title
                if !active.url.isEmpty { url = active.url }
            }
        case let .control(held, owned, controlling):
            self.held = held
            self.owned = owned
            self.controlling = controlling
        case .offline:
            offline = true
        case .status, .heartbeat:
            break
        case let .error(message, _):
            error = message
        }
        return nil
    }
}

/// The page's size in pixels (the core builds without CoreGraphics).
public struct BrowserPageSize: Equatable, Sendable {
    public var width: Int
    public var height: Int
}

/// What the person does to the bot's browser from the take-control window
/// (`parseBrowserLiveAction` in server/browser/browser-live.ts). Coordinates are page
/// pixels.
public enum BrowserLiveAction: Equatable, Sendable {
    case take, release
    case back, forward, reload
    case mouse(event: String, x: Double, y: Double, button: String = "none", clickCount: Int = 0,
               deltaX: Double = 0, deltaY: Double = 0)
    /// Typed text, inserted as is.
    case text(String)
    /// One whole press of a named key (Enter, Backspace, Tab, Escape, ArrowUp...).
    case key(String)

    /// The request body, without `viewerId`.
    public var body: [String: Any] {
        switch self {
        case .take: return ["type": "take"]
        case .release: return ["type": "release"]
        case .back: return ["type": "back"]
        case .forward: return ["type": "forward"]
        case .reload: return ["type": "reload"]
        case let .mouse(event, x, y, button, clickCount, deltaX, deltaY):
            func clamp(_ value: Double) -> Double { min(8192, max(0, value.rounded())) }
            var body: [String: Any] = ["type": "input_mouse", "eventType": event, "x": clamp(x), "y": clamp(y),
                                       "button": button, "clickCount": clickCount]
            if event == "mouseWheel" {
                body["deltaX"] = min(10_000, max(-10_000, deltaX.rounded()))
                body["deltaY"] = min(10_000, max(-10_000, deltaY.rounded()))
            }
            return body
        case let .text(text):
            return ["type": "input_keyboard", "eventType": "char", "text": String(text.prefix(4096))]
        case let .key(key):
            return ["type": "input_keyboard", "eventType": "keyDown", "key": key]
        }
    }

    /// Whether this starts an interaction with the page, so it takes the
    /// browser from the bot first (browser-control.ts `startsInteraction`).
    public var interacts: Bool {
        switch self {
        case .take, .release: return false
        case let .mouse(event, _, _, _, _, _, _): return event == "mousePressed" || event == "mouseWheel"
        default: return true
        }
    }

    /// A key on the phone's keyboard accessory, as the page's key name.
    public static func special(_ key: RemoteSpecialKey) -> BrowserLiveAction {
        switch key {
        case .escape: return .key("Escape")
        case .tab: return .key("Tab")
        case .up: return .key("ArrowUp")
        case .down: return .key("ArrowDown")
        case .left: return .key("ArrowLeft")
        case .right: return .key("ArrowRight")
        }
    }

    /// Text typed on the phone: a line break is Enter, the rest is inserted.
    public static func typed(_ text: String) -> [BrowserLiveAction] {
        var actions: [BrowserLiveAction] = []
        var run = ""
        for character in text {
            if character == "\n" || character == "\r\n" || character == "\r" {
                if !run.isEmpty { actions.append(.text(run)); run = "" }
                actions.append(.key("Enter"))
            } else {
                run.append(character)
            }
        }
        if !run.isEmpty { actions.append(.text(run)) }
        return actions
    }
}

/// Where a point on the shown picture lands on the page: the picture is drawn
/// aspect-fit in `view`, so the bars around it map to nothing.
public enum BrowserPagePoint {
    public static func map(x: Double, y: Double, viewWidth: Double, viewHeight: Double,
                           page: BrowserPageSize) -> (x: Double, y: Double)? {
        let pageWidth = Double(max(page.width, 1)), pageHeight = Double(max(page.height, 1))
        guard viewWidth > 0, viewHeight > 0 else { return nil }
        let scale = min(viewWidth / pageWidth, viewHeight / pageHeight)
        let shownWidth = pageWidth * scale, shownHeight = pageHeight * scale
        let originX = (viewWidth - shownWidth) / 2, originY = (viewHeight - shownHeight) / 2
        let px = (x - originX) / scale, py = (y - originY) / scale
        guard px >= 0, py >= 0, px <= pageWidth, py <= pageHeight else { return nil }
        return (px, py)
    }
}
