// The iOS calls behind each phone tool. Each runs only after the person
// approved on this phone, with the app on screen; each asks iOS for its own
// permission the first time (Info.plist usage descriptions, fr and en in
// InfoPlist.xcstrings) and reads only what the request needs. Shaping is
// CompanionCore's (PhoneToolShaping): the answer carries the fields asked
// for and nothing else. Errors are in English: the bot reads them.
import Contacts
import CoreLocation
import EventKit
import Intents
import Network
import UIKit
import CompanionCore

enum PhoneToolError: LocalizedError {
    case permission(String)
    case invalid(String)
    case unavailable(String)

    var errorDescription: String? {
        switch self {
        case let .permission(what): "The person has not given Sagax access to \(what) on this phone (Settings > Sagax)."
        case let .invalid(why): why
        case let .unavailable(why): why
        }
    }
}

@MainActor
enum PhoneToolRunner {
    static func run(_ request: PhoneToolRequest, photos: [Data]?, card: WidgetJSON? = nil) async throws -> WidgetJSON {
        guard let tool = request.tool else { throw PhoneToolError.invalid("This phone does not know that tool.") }
        switch tool {
        case .location: return try await location(precise: request.flag("precise"))
        case .contacts: return try await contacts(request)
        case .reminders: return try await reminders(request)
        case .calendar: return try await calendar(request)
        case .photos:
            guard let photos else { throw PhoneToolError.invalid("No photo was picked.") }
            return PhoneToolShaping.photos(photos, max: request.int("max"))
        case .shortcut: return try await shortcut(request)
        case .clipboard: return PhoneToolShaping.clipboard(UIPasteboard.general.hasStrings ? UIPasteboard.general.string : nil)
        case .status: return await status()
        case .cardScan:
            guard let card else { throw PhoneToolError.invalid("No card was read.") }
            return card
        }
    }

    // MARK: Location: one fix, then the manager is gone

    private static func location(precise: Bool) async throws -> WidgetJSON {
        let fix = try await OneShotLocation().fetch()
        return PhoneToolShaping.location(latitude: fix.coordinate.latitude, longitude: fix.coordinate.longitude, accuracy: fix.horizontalAccuracy, at: fix.timestamp, precise: precise)
    }

    // MARK: Contacts: a name search, only the keys asked for

    private static func contacts(_ request: PhoneToolRequest) async throws -> WidgetJSON {
        guard let query = request.string("query") else { throw PhoneToolError.invalid("contacts needs query.") }
        let store = CNContactStore()
        let granted = (try? await store.requestAccess(for: .contacts)) ?? false
        guard granted else { throw PhoneToolError.permission("Contacts") }
        let fields = PhoneToolShaping.requestedFields(request)
        var keys: [CNKeyDescriptor] = [CNContactFormatter.descriptorForRequiredKeys(for: .fullName)]
        if fields.contains("phone") { keys.append(CNContactPhoneNumbersKey as CNKeyDescriptor) }
        if fields.contains("email") { keys.append(CNContactEmailAddressesKey as CNKeyDescriptor) }
        if fields.contains("address") { keys.append(CNContactPostalAddressesKey as CNKeyDescriptor) }
        if fields.contains("birthday") { keys.append(CNContactBirthdayKey as CNKeyDescriptor) }
        if fields.contains("organization") { keys.append(CNContactOrganizationNameKey as CNKeyDescriptor) }
        let limit = PhoneToolShaping.contactLimit(request)
        let found: [PhoneContact] = try await Task.detached(priority: .userInitiated) {
            let matches = try store.unifiedContacts(matching: CNContact.predicateForContacts(matchingName: query), keysToFetch: keys)
            let postal = CNPostalAddressFormatter()
            return matches.prefix(limit).map { contact in
                PhoneContact(
                    name: CNContactFormatter.string(from: contact, style: .fullName) ?? "",
                    phones: fields.contains("phone") ? contact.phoneNumbers.map { $0.value.stringValue } : [],
                    emails: fields.contains("email") ? contact.emailAddresses.map { String($0.value) } : [],
                    addresses: fields.contains("address") ? contact.postalAddresses.map { postal.string(from: $0.value).replacingOccurrences(of: "\n", with: ", ") } : [],
                    birthday: fields.contains("birthday") ? contact.birthday.flatMap(Self.birthday) : nil,
                    organization: fields.contains("organization") ? contact.organizationName : nil
                )
            }
        }.value
        return PhoneToolShaping.contacts(found, for: request)
    }

    nonisolated private static func birthday(_ components: DateComponents) -> String? {
        guard let month = components.month, let day = components.day else { return nil }
        if let year = components.year { return String(format: "%04d-%02d-%02d", year, month, day) }
        return String(format: "--%02d-%02d", month, day)
    }

    // MARK: Reminders and calendar (EventKit)

    private static func reminders(_ request: PhoneToolRequest) async throws -> WidgetJSON {
        let store = EKEventStore()
        guard await access(store, to: .reminder) else { throw PhoneToolError.permission("Reminders") }
        let lists = store.calendars(for: .reminder)
        let named = request.string("list").flatMap { name in lists.first { $0.title.localizedCaseInsensitiveCompare(name) == .orderedSame } }
        if request.action == "create" {
            guard let title = request.string("title") else { throw PhoneToolError.invalid("reminders create needs title.") }
            let reminder = EKReminder(eventStore: store)
            reminder.title = title
            reminder.notes = request.string("notes")
            reminder.calendar = named ?? store.defaultCalendarForNewReminders()
            if let due = PhoneToolShaping.date(request.string("due")) {
                reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: due)
            }
            guard reminder.calendar != nil else { throw PhoneToolError.unavailable("There is no reminders list on this phone.") }
            try store.save(reminder, commit: true)
            return PhoneToolShaping.createdReminder(PhoneReminder(title: title, due: reminder.dueDateComponents?.date, list: reminder.calendar.title))
        }
        let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: named.map { [$0] })
        let found: [PhoneReminder] = await withCheckedContinuation { done in
            store.fetchReminders(matching: predicate) { rows in
                let mapped = (rows ?? []).map { PhoneReminder(title: $0.title ?? "", due: $0.dueDateComponents?.date, list: $0.calendar?.title) }
                done.resume(returning: mapped)
            }
        }
        return PhoneToolShaping.reminders(found, limit: request.int("limit"))
    }

    private static func calendar(_ request: PhoneToolRequest) async throws -> WidgetJSON {
        let store = EKEventStore()
        guard await access(store, to: .event) else { throw PhoneToolError.permission("Calendar") }
        if request.action == "create" {
            guard let title = request.string("title"),
                  let start = PhoneToolShaping.date(request.string("start")),
                  let end = PhoneToolShaping.date(request.string("end")), end >= start
            else { throw PhoneToolError.invalid("calendar create needs title, start and end (ISO 8601).") }
            guard let target = store.defaultCalendarForNewEvents else { throw PhoneToolError.unavailable("There is no calendar to add to on this phone.") }
            let event = EKEvent(eventStore: store)
            event.title = title
            event.startDate = start
            event.endDate = end
            event.location = request.string("location")
            event.notes = request.string("notes")
            event.calendar = target
            try store.save(event, span: .thisEvent, commit: true)
            return PhoneToolShaping.createdEvent(PhoneEvent(title: title, start: start, end: end, location: event.location, calendar: target.title))
        }
        guard let from = PhoneToolShaping.date(request.string("from")), let to = PhoneToolShaping.date(request.string("to")), to > from,
              to.timeIntervalSince(from) <= 31 * 24 * 3600
        else { throw PhoneToolError.invalid("calendar list needs from and to (ISO 8601), at most 31 days apart.") }
        let found = store.events(matching: store.predicateForEvents(withStart: from, end: to, calendars: nil)).map {
            PhoneEvent(title: $0.title ?? "", start: $0.startDate, end: $0.endDate, allDay: $0.isAllDay, location: $0.location, calendar: $0.calendar?.title)
        }
        return PhoneToolShaping.events(found, limit: request.int("limit"))
    }

    /// Full access (iOS 17 asks for it by name); iOS 16 has one kind.
    private static func access(_ store: EKEventStore, to type: EKEntityType) async -> Bool {
        if #available(iOS 17.0, *) {
            return (try? await (type == .reminder ? store.requestFullAccessToReminders() : store.requestFullAccessToEvents())) ?? false
        }
        return (try? await store.requestAccess(to: type)) ?? false
    }

    // MARK: Shortcuts: opens the Shortcuts app on that shortcut

    private static func shortcut(_ request: PhoneToolRequest) async throws -> WidgetJSON {
        guard let name = request.string("name"), let url = PhoneToolShaping.shortcutURL(name: name, input: request.string("input")) else {
            throw PhoneToolError.invalid("shortcut needs name.")
        }
        let opened = await UIApplication.shared.open(url)
        guard opened else { throw PhoneToolError.unavailable("Shortcuts could not be opened on this phone.") }
        return .object(["started": .bool(true)])
    }

    // MARK: Status: battery, Low Power Mode, network, Focus

    private static func status() async -> WidgetJSON {
        let device = UIDevice.current
        let wasMonitoring = device.isBatteryMonitoringEnabled
        device.isBatteryMonitoringEnabled = true
        let level = device.batteryLevel
        let state: String? = switch device.batteryState {
        case .charging: "charging"
        case .full: "full"
        case .unplugged: "unplugged"
        default: "unknown"
        }
        device.isBatteryMonitoringEnabled = wasMonitoring
        let path = await OneShotPath.current()
        return PhoneToolShaping.status(
            batteryLevel: level >= 0 ? level : nil,
            batteryState: state,
            lowPowerMode: ProcessInfo.processInfo.isLowPowerModeEnabled,
            network: path,
            focused: await focus()
        )
    }

    /// Whether a Focus is on, when the person allowed Sagax to see it.
    private static func focus() async -> Bool? {
        let center = INFocusStatusCenter.default
        if center.authorizationStatus == .notDetermined {
            _ = await withCheckedContinuation { (done: CheckedContinuation<INFocusStatusAuthorizationStatus, Never>) in
                center.requestAuthorization { done.resume(returning: $0) }
            }
        }
        guard center.authorizationStatus == .authorized else { return nil }
        return center.focusStatus.isFocused
    }
}

/// One Core Location fix, with a 15 s limit. Asks When In Use the first time.
@MainActor
private final class OneShotLocation: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocation, Error>?
    private var started = false

    func fetch() async throws -> CLLocation {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                self?.finish(.failure(PhoneToolError.unavailable("The phone could not find its position in time.")))
            }
            begin()
        }
    }

    private func begin() {
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .denied, .restricted: finish(.failure(PhoneToolError.permission("Location")))
        default:
            started = true
            manager.requestLocation()
        }
    }

    private func finish(_ result: Result<CLLocation, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        manager.stopUpdatingLocation()
        manager.delegate = nil
        continuation.resume(with: result)
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in if !self.started { self.begin() } }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        Task { @MainActor in self.finish(.success(last)) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.finish(.failure(PhoneToolError.unavailable("The phone could not find its position."))) }
    }
}

/// The first of two callbacks wins; the other does nothing.
private final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var taken = false
    func claim() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if taken { return false }
        taken = true
        return true
    }
}

/// The network path once, then the monitor stops.
private enum OneShotPath {
    static func current() async -> (status: String, type: String?, expensive: Bool, constrained: Bool)? {
        await withCheckedContinuation { done in
            let monitor = NWPathMonitor()
            let queue = DispatchQueue(label: "sagax.phone-tools.path")
            let once = Once()
            monitor.pathUpdateHandler = { path in
                guard once.claim() else { return }
                monitor.cancel()
                let status: String = switch path.status {
                case .satisfied: "satisfied"
                case .requiresConnection: "requiresConnection"
                default: "unsatisfied"
                }
                let type: String? = path.usesInterfaceType(.wifi) ? "wifi"
                    : path.usesInterfaceType(.cellular) ? "cellular"
                    : path.usesInterfaceType(.wiredEthernet) ? "wired"
                    : path.status == .satisfied ? "other" : "none"
                done.resume(returning: (status, type, path.isExpensive, path.isConstrained))
            }
            monitor.start(queue: queue)
            queue.asyncAfter(deadline: .now() + 3) {
                guard once.claim() else { return }
                monitor.cancel()
                done.resume(returning: nil)
            }
        }
    }
}
