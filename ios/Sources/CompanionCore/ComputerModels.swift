import Foundation

// Wire models and pure input logic for the phone's native computer viewer
// (visual parity screens 13 and 11). The routes are documented in
// docs/ios-companion.md "Visual parity routes"; the event shapes mirror
// server/computer/computer-input.ts `computerInputEventSchema`.

// MARK: - Events

public enum ComputerMouseButton: String, Codable, Sendable { case left, right, middle }
public enum ComputerButtonAction: String, Codable, Sendable { case click, down, up }
public enum ComputerModifier: String, Codable, Sendable, CaseIterable { case shift, ctrl, alt, meta }

/// One event of `POST /api/bots/:id/computer/input`.
public enum ComputerInputEvent: Equatable, Sendable, Encodable {
    /// Relative pointer move, in remote pixels.
    case move(dx: Int, dy: Int)
    /// Absolute pointer move, as fractions (0...1) of the remote screen.
    case moveTo(x: Double, y: Double)
    case button(ComputerMouseButton, ComputerButtonAction, count: Int? = nil)
    /// Wheel ticks: positive dy scrolls down, positive dx scrolls right.
    case scroll(dx: Int, dy: Int)
    case key(String, modifiers: [ComputerModifier] = [])
    case text(String)

    /// The server's limits (computer-input.ts).
    public static let maxMove = 10_000
    public static let maxScroll = 50
    public static let maxText = 1_000
    public static let maxBatch = 64

    private enum Keys: String, CodingKey { case type, dx, dy, x, y, button, action, count, key, modifiers, text }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case let .move(dx, dy):
            try c.encode("move", forKey: .type)
            try c.encode(dx, forKey: .dx)
            try c.encode(dy, forKey: .dy)
        case let .moveTo(x, y):
            try c.encode("moveTo", forKey: .type)
            try c.encode(x, forKey: .x)
            try c.encode(y, forKey: .y)
        case let .button(button, action, count):
            try c.encode("button", forKey: .type)
            try c.encode(button, forKey: .button)
            try c.encode(action, forKey: .action)
            try c.encodeIfPresent(count, forKey: .count)
        case let .scroll(dx, dy):
            try c.encode("scroll", forKey: .type)
            try c.encode(dx, forKey: .dx)
            try c.encode(dy, forKey: .dy)
        case let .key(key, modifiers):
            try c.encode("key", forKey: .type)
            try c.encode(key, forKey: .key)
            if !modifiers.isEmpty { try c.encode(modifiers, forKey: .modifiers) }
        case let .text(text):
            try c.encode("text", forKey: .type)
            try c.encode(text, forKey: .text)
        }
    }
}

struct ComputerInputBody: Encodable {
    var events: [ComputerInputEvent]
    var controlLeaseId: String?
}

struct ComputerClipboardBody: Encodable {
    var text: String
    var controlLeaseId: String?
}

struct ComputerControlBody: Encodable {
    var action: String
    var controlLeaseId: String?
}

// MARK: - Responses

/// `POST /api/bots/:id/computer/input` -> `{ ok, applied }`.
public struct ComputerInputResult: Decodable, Sendable, Equatable {
    public var ok: Bool
    public var applied: Int?
}

/// `GET /api/bots/:id/computer/clipboard` -> `{ text }`.
public struct ComputerClipboard: Decodable, Sendable, Equatable {
    public var text: String
}

/// `GET/POST /api/bots/:id/computer/control`: who drives the computer.
public struct ComputerControlState: Decodable, Sendable, Equatable {
    /// True while a person drives; the bot's hands are refused.
    public var held: Bool
    public var helpReason: String?
    public var heldSinceMs: Double?
    /// With a lease: whether this lease owns the hold.
    public var owned: Bool?
    public var acquired: Bool?
    public var released: Bool?

    public init(held: Bool, helpReason: String? = nil, heldSinceMs: Double? = nil, owned: Bool? = nil, acquired: Bool? = nil, released: Bool? = nil) {
        self.held = held
        self.helpReason = helpReason
        self.heldSinceMs = heldSinceMs
        self.owned = owned
        self.acquired = acquired
        self.released = released
    }
}

/// `POST /api/bots/:id/computer/screenshot` -> `{ png (base64), format | mime }`.
public struct ComputerScreenshot: Decodable, Sendable, Equatable {
    public var png: String
    public var format: String?
    public var mime: String?

    public var data: Data? { Data(base64Encoded: png) }
}

/// A refused computer call, by the server's `code`.
public enum ComputerError: Error, Equatable, Sendable, LocalizedError {
    /// 409 `no_control`: take control first.
    case noControl
    /// 409 `control_lease`: someone else's lease holds control.
    case controlHeldElsewhere
    /// 404 `no_computer`: the bot has no desktop to drive.
    case noComputer
    /// Could not reach the computer at all.
    case offline(String)
    case other(status: Int?, message: String)

    public var errorDescription: String? {
        switch self {
        case .noControl: "Take control of this computer first."
        case .controlHeldElsewhere: "Someone else holds control of this computer."
        case .noComputer: "This bot has no computer."
        case let .offline(detail): detail
        case let .other(_, message): message
        }
    }

    /// Classify a status and the server's `{ error, code }` body.
    public static func from(status: Int, body: Data) -> ComputerError {
        struct Body: Decodable { var error: String?; var code: String? }
        let parsed = try? JSONDecoder().decode(Body.self, from: body)
        switch (status, parsed?.code) {
        case (409, "no_control"): return .noControl
        case (409, "control_lease"): return .controlHeldElsewhere
        case (404, "no_computer"): return .noComputer
        default:
            return .other(status: status, message: parsed?.error ?? "The computer answered with an error (\(status)).")
        }
    }
}

// MARK: - Pointer acceleration

/// Turns finger travel on the phone (points) into remote pixels, the way a
/// trackpad does: slow strokes are precise, fast strokes cover the screen.
/// Sub-pixel remainders carry over so slow drags still move.
public struct PointerAccelerator: Sendable, Equatable {
    /// Remote pixels per phone point at rest (the frame's scale).
    public var baseGain: Double
    /// Speed (pt/s) where acceleration starts, and its strength.
    public var threshold: Double = 250
    public var maxBoost: Double = 2.5
    public var boostPerPoint: Double = 1.0 / 600
    private var remainderX = 0.0
    private var remainderY = 0.0

    public init(baseGain: Double = 1) {
        self.baseGain = baseGain
    }

    /// The gain at a finger speed in points per second.
    public func gain(speed: Double) -> Double {
        let over = max(0, speed - threshold)
        return baseGain * min(maxBoost, 1 + over * boostPerPoint)
    }

    /// Whole remote pixels to move for a finger delta over `interval` seconds.
    public mutating func pixels(dx: Double, dy: Double, interval: Double) -> (dx: Int, dy: Int) {
        let speed = interval > 0 ? (dx * dx + dy * dy).squareRoot() / interval : 0
        let g = gain(speed: speed)
        let x = dx * g + remainderX
        let y = dy * g + remainderY
        let ix = Int(x.rounded(.towardZero))
        let iy = Int(y.rounded(.towardZero))
        remainderX = x - Double(ix)
        remainderY = y - Double(iy)
        return (ix, iy)
    }

    public mutating func reset() {
        remainderX = 0
        remainderY = 0
    }
}

// MARK: - Gestures

/// What the person did on the trackpad surface.
public enum TrackpadGesture: Equatable, Sendable {
    /// One finger moving, in phone points, over `interval` seconds.
    case pan(dx: Double, dy: Double, interval: Double)
    case tap
    case doubleTap
    case twoFingerTap
    /// Two fingers moving, in phone points (content follows the fingers).
    case scroll(dx: Double, dy: Double)
    /// Long press, then drag: button down, moves, button up.
    case dragBegan
    case dragChanged(dx: Double, dy: Double, interval: Double)
    case dragEnded
}

/// Gesture -> input events, with acceleration and scroll accumulation.
public struct TrackpadTranslator: Sendable {
    public var accelerator: PointerAccelerator
    /// Finger travel (pt) per wheel tick.
    public var pointsPerScrollTick: Double = 12
    /// Natural scrolling: fingers up scroll the content down.
    public var naturalScrolling = true
    private var scrollRemainderX = 0.0
    private var scrollRemainderY = 0.0
    public private(set) var dragging = false

    public init(baseGain: Double = 1) {
        accelerator = PointerAccelerator(baseGain: baseGain)
    }

    public mutating func events(for gesture: TrackpadGesture) -> [ComputerInputEvent] {
        switch gesture {
        case let .pan(dx, dy, interval), let .dragChanged(dx, dy, interval):
            let px = accelerator.pixels(dx: dx, dy: dy, interval: interval)
            return px.dx == 0 && px.dy == 0 ? [] : [.move(dx: px.dx, dy: px.dy)]
        case .tap:
            return [.button(.left, .click)]
        case .doubleTap:
            return [.button(.left, .click, count: 2)]
        case .twoFingerTap:
            return [.button(.right, .click)]
        case let .scroll(dx, dy):
            let sign = naturalScrolling ? -1.0 : 1.0
            let x = sign * dx / pointsPerScrollTick + scrollRemainderX
            let y = sign * dy / pointsPerScrollTick + scrollRemainderY
            let ix = Int(x.rounded(.towardZero))
            let iy = Int(y.rounded(.towardZero))
            scrollRemainderX = x - Double(ix)
            scrollRemainderY = y - Double(iy)
            return ix == 0 && iy == 0 ? [] : [.scroll(dx: ix, dy: iy)]
        case .dragBegan:
            dragging = true
            accelerator.reset()
            return [.button(.left, .down)]
        case .dragEnded:
            guard dragging else { return [] }
            dragging = false
            return [.button(.left, .up)]
        }
    }

    public mutating func resetScroll() {
        scrollRemainderX = 0
        scrollRemainderY = 0
    }
}

// MARK: - Batching

/// Collects events between flushes (about 60 Hz) and sends at most one batch
/// at a time: consecutive moves and consecutive scrolls merge, so a fast
/// stroke during a slow round trip becomes one move, not a backlog.
public struct ComputerInputBatcher: Sendable {
    public private(set) var pending: [ComputerInputEvent] = []

    public init() {}

    public var isEmpty: Bool { pending.isEmpty }

    public mutating func append(_ event: ComputerInputEvent) {
        if let last = pending.last {
            switch (last, event) {
            case let (.move(ax, ay), .move(bx, by)):
                let x = ax + bx, y = ay + by
                if abs(x) <= ComputerInputEvent.maxMove, abs(y) <= ComputerInputEvent.maxMove {
                    pending[pending.count - 1] = .move(dx: x, dy: y)
                    return
                }
            case let (.scroll(ax, ay), .scroll(bx, by)):
                let x = ax + bx, y = ay + by
                if abs(x) <= ComputerInputEvent.maxScroll, abs(y) <= ComputerInputEvent.maxScroll {
                    pending[pending.count - 1] = .scroll(dx: x, dy: y)
                    return
                }
            case let (.text(a), .text(b)) where a.count + b.count <= ComputerInputEvent.maxText:
                pending[pending.count - 1] = .text(a + b)
                return
            default:
                break
            }
        }
        pending.append(event)
    }

    public mutating func append(contentsOf events: [ComputerInputEvent]) {
        for event in events { append(event) }
    }

    /// The next batch to send (at most `max` events), removed from the queue.
    public mutating func drain(max: Int = ComputerInputEvent.maxBatch) -> [ComputerInputEvent] {
        let count = min(max, pending.count)
        let batch = Array(pending.prefix(count))
        pending.removeFirst(count)
        return batch
    }

    public mutating func clear() { pending.removeAll() }
}

// MARK: - Keyboard

/// A key on the accessory bar.
public enum RemoteSpecialKey: String, CaseIterable, Sendable {
    case escape = "Escape", tab = "Tab", up = "Up", down = "Down", left = "Left", right = "Right"
}

/// Typing on the phone -> text and key events. Sticky modifiers from the
/// accessory bar turn the next character into a chord (ctrl+c), then clear.
public struct RemoteKeyboardTranslator: Sendable, Equatable {
    public private(set) var modifiers: Set<ComputerModifier> = []

    public init() {}

    public mutating func toggle(_ modifier: ComputerModifier) {
        if modifiers.contains(modifier) { modifiers.remove(modifier) } else { modifiers.insert(modifier) }
    }

    private var orderedModifiers: [ComputerModifier] {
        ComputerModifier.allCases.filter(modifiers.contains)
    }

    /// What `insertText` produced. Newline is Return, tab is Tab.
    public mutating func insert(_ text: String) -> [ComputerInputEvent] {
        guard !text.isEmpty else { return [] }
        if !modifiers.isEmpty {
            // A chord takes one key; anything longer is typed as is.
            if text.count == 1, let key = Self.keyName(for: text) {
                let chord = ComputerInputEvent.key(key, modifiers: orderedModifiers)
                modifiers.removeAll()
                return [chord]
            }
            modifiers.removeAll()
        }
        var events: [ComputerInputEvent] = []
        var run = ""
        func flush() {
            // Long pastes go in server-sized pieces.
            while !run.isEmpty {
                let piece = String(run.prefix(ComputerInputEvent.maxText))
                events.append(.text(piece))
                run.removeFirst(piece.count)
            }
        }
        for character in text {
            switch character {
            case "\n", "\r", "\r\n":
                flush()
                events.append(.key("Return"))
            case "\t":
                flush()
                events.append(.key("Tab"))
            default:
                run.append(character)
            }
        }
        flush()
        return events
    }

    public mutating func deleteBackward() -> [ComputerInputEvent] {
        let event = ComputerInputEvent.key("BackSpace", modifiers: orderedModifiers)
        modifiers.removeAll()
        return [event]
    }

    public mutating func special(_ key: RemoteSpecialKey) -> [ComputerInputEvent] {
        let event = ComputerInputEvent.key(key.rawValue, modifiers: orderedModifiers)
        modifiers.removeAll()
        return [event]
    }

    /// The server's key name for one typed character, when it has one.
    static func keyName(for character: String) -> String? {
        guard character.count == 1 else { return nil }
        if character == " " { return "space" }
        if character.range(of: "^[A-Za-z0-9]$", options: .regularExpression) != nil { return character.lowercased() }
        let punctuation: Set<String> = ["-", "=", "[", "]", "\\", ";", "'", ",", ".", "/", "`", "!", "@", "#", "$", "%",
                                        "^", "&", "*", "(", ")", "_", "+", "{", "}", "|", ":", "\"", "<", ">", "?", "~"]
        return punctuation.contains(character) ? character : nil
    }
}

// MARK: - Pointer position

/// Where the remote pointer is believed to be, as fractions of the remote
/// screen: synced with a `moveTo` when control starts, then moved by the
/// relative events actually sent.
public struct RemotePointerEstimate: Sendable, Equatable {
    public var x: Double
    public var y: Double

    public init(x: Double = 0.5, y: Double = 0.5) {
        self.x = x
        self.y = y
    }

    /// Apply events sent to a screen `width` x `height` remote pixels.
    public mutating func apply(_ events: [ComputerInputEvent], width: Double, height: Double) {
        guard width > 0, height > 0 else { return }
        for event in events {
            switch event {
            case let .move(dx, dy):
                x = min(1, max(0, x + Double(dx) / width))
                y = min(1, max(0, y + Double(dy) / height))
            case let .moveTo(nx, ny):
                x = min(1, max(0, nx))
                y = min(1, max(0, ny))
            default:
                break
            }
        }
    }
}

// MARK: - Control lease

public enum ComputerControlLease {
    /// A fresh lease id: 32 characters of [A-Za-z0-9], as the server's
    /// `controlLeaseIdSchema` wants (16 to 120 of [A-Za-z0-9_-]).
    public static func make() -> String {
        UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    }
}
