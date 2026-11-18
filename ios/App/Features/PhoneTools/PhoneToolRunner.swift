// The iOS calls behind each phone tool. Each runs only after the person
// approved on this phone, with the app on screen; each asks iOS for its own
// permission the first time (Info.plist usage descriptions, fr and en in
// InfoPlist.xcstrings) and reads only what the request needs. Shaping is
// CompanionCore's (PhoneToolShaping): the answer carries the fields asked
// for and nothing else. Errors are in English: the bot reads them.
import AlarmKit
import Contacts
import CoreLocation
import EventKit
import HomeKit
import Intents
import Network
import Photos
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
        case .home: return try await home(request)
        case .alarms: return try await alarms(request)
        case .photos:
            guard let photos else { throw PhoneToolError.invalid("No photo was picked.") }
            return PhoneToolShaping.photos(photos, max: request.int("max"))
        case .photoLibrary: return try await photoLibrary(request)
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

    // MARK: Home: list scenes and accessories, or run one scene

    private static func home(_ request: PhoneToolRequest) async throws -> WidgetJSON {
        let lookup = HomeLookup()
        let homes = try await lookup.load()
        if request.action == "run" {
            guard let sceneName = request.string("scene") else { throw PhoneToolError.invalid("home run needs scene.") }
            let wanted = request.string("home")
            for house in homes where wanted == nil || house.name.localizedCaseInsensitiveCompare(wanted!) == .orderedSame {
                if let scene = house.actionSets.first(where: { $0.name.localizedCaseInsensitiveCompare(sceneName) == .orderedSame }) {
                    try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
                        house.executeActionSet(scene) { error in
                            if let error { done.resume(throwing: error) } else { done.resume() }
                        }
                    }
                    return PhoneToolShaping.ranHome(home: house.name, scene: scene.name)
                }
            }
            throw PhoneToolError.unavailable("No scene with that name is on this phone.")
        }
        let wanted = request.string("home")
        let rows = homes.filter { wanted == nil || $0.name.localizedCaseInsensitiveCompare(wanted!) == .orderedSame }.map(snapshot)
        return PhoneToolShaping.homes(rows, limit: request.int("limit"))
    }

    private static func snapshot(_ house: HMHome) -> PhoneHome {
        let power = HMCharacteristicTypePowerState
        let accessories = house.accessories.map { accessory in
            let on = accessory.services.lazy.flatMap(\.characteristics).first { $0.characteristicType == power }?.value as? Bool
            return PhoneAccessory(name: accessory.name, room: accessory.room?.name, on: on)
        }
        return PhoneHome(name: house.name, scenes: house.actionSets.map(\.name), accessories: accessories)
    }

    // MARK: Alarms: list, or add one at an hour and a minute

    private static func alarms(_ request: PhoneToolRequest) async throws -> WidgetJSON {
        guard #available(iOS 26.0, *) else {
            throw PhoneToolError.unavailable("Alarms on this phone need a newer system. Update the phone, then ask again.")
        }
        return try await alarmsOnModernSystem(request)
    }

    @available(iOS 26.0, *)
    private static func alarmsOnModernSystem(_ request: PhoneToolRequest) async throws -> WidgetJSON {
        let manager = AlarmManager.shared
        let state = try await manager.requestAuthorization()
        guard state == .authorized else { throw PhoneToolError.permission("Alarms") }
        if request.action == "create" {
            guard let label = request.string("label"),
                  let hour = request.int("hour"), (0...23).contains(hour),
                  let minute = request.int("minute"), (0...59).contains(minute)
            else { throw PhoneToolError.invalid("alarms create needs label, hour and minute.") }
            let stop = AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.circle")
            let alert = AlarmPresentation.Alert(title: LocalizedStringResource(stringLiteral: label), stopButton: stop)
            let attributes = AlarmAttributes<PhoneAlarmMetadata>(presentation: AlarmPresentation(alert: alert), tintColor: .orange)
            let time = Alarm.Schedule.Relative.Time(hour: hour, minute: minute)
            let schedule = Alarm.Schedule.relative(.init(time: time, repeats: .never))
            let configuration = AlarmManager.AlarmConfiguration<PhoneAlarmMetadata>.alarm(schedule: schedule, attributes: attributes)
            _ = try await manager.schedule(id: UUID(), configuration: configuration)
            return PhoneToolShaping.createdAlarm(PhoneAlarm(label: label, hour: hour, minute: minute, enabled: true))
        }
        let found = try manager.alarms.compactMap(listedAlarm)
        return PhoneToolShaping.alarms(found, limit: request.int("limit"))
    }

    @available(iOS 26.0, *)
    private static func listedAlarm(_ alarm: Alarm) -> PhoneAlarm? {
        guard let schedule = alarm.schedule, case .relative(let relative) = schedule else { return nil }
        return PhoneAlarm(label: "Alarm", hour: relative.time.hour, minute: relative.time.minute, enabled: true)
    }

    /// Full access (iOS 17 asks for it by name); iOS 16 has one kind.
    private static func access(_ store: EKEventStore, to type: EKEntityType) async -> Bool {
        if #available(iOS 17.0, *) {
            return (try? await (type == .reminder ? store.requestFullAccessToReminders() : store.requestFullAccessToEvents())) ?? false
        }
        return (try? await store.requestAccess(to: type)) ?? false
    }

    // MARK: Photo library (PhotoKit): albums, a search, details, photos as images

    private static func photoLibrary(_ request: PhoneToolRequest) async throws -> WidgetJSON {
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        guard status == .authorized || status == .limited else { throw PhoneToolError.permission("Photos") }
        let limited = status == .limited
        switch request.action {
        case "list_albums": return libraryAlbums(request, limited: limited)
        case "read": return libraryRead(request, limited: limited)
        case "export": return try await libraryExport(request, limited: limited)
        default: return try librarySearch(request, limited: limited)
        }
    }

    private static func allAlbums() -> [(PHAssetCollection, Bool)] {
        var found: [(PHAssetCollection, Bool)] = []
        for (type, smart) in [(PHAssetCollectionType.album, false), (PHAssetCollectionType.smartAlbum, true)] {
            PHAssetCollection.fetchAssetCollections(with: type, subtype: .any, options: nil).enumerateObjects { collection, _, _ in
                found.append((collection, smart))
            }
        }
        return found
    }

    private static func libraryAlbums(_ request: PhoneToolRequest, limited: Bool) -> WidgetJSON {
        let rows: [PhoneLibraryAlbum] = allAlbums().compactMap { collection, smart in
            let count = PHAsset.fetchAssets(in: collection, options: nil).count
            if smart && count == 0 { return nil }
            return PhoneLibraryAlbum(id: collection.localIdentifier, name: collection.localizedTitle ?? "", count: count, smart: smart)
        }
        let window = PhoneToolShaping.libraryWindow(request, defaultLimit: 100, max: 200)
        return PhoneToolShaping.libraryAlbums(rows, offset: window.offset, limit: window.limit, limited: limited)
    }

    /// An album by its id, else by its name (case and accents ignored).
    private static func album(_ key: String) -> PHAssetCollection? {
        if let byId = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [key], options: nil).firstObject { return byId }
        return allAlbums().first { ($0.0.localizedTitle ?? "").compare(key, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }?.0
    }

    private static func librarySearch(_ request: PhoneToolRequest, limited: Bool) throws -> WidgetJSON {
        var parts: [NSPredicate] = []
        if let from = PhoneToolShaping.date(request.string("from")) { parts.append(NSPredicate(format: "creationDate >= %@", from as NSDate)) }
        if let to = PhoneToolShaping.date(request.string("to")) { parts.append(NSPredicate(format: "creationDate < %@", to as NSDate)) }
        if let favorite = request.args["favorite"]?.bool { parts.append(NSPredicate(format: "favorite == %@", NSNumber(value: favorite))) }
        switch request.string("media") {
        case "photo": parts.append(NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue))
        case "video": parts.append(NSPredicate(format: "mediaType == %d", PHAssetMediaType.video.rawValue))
        default: break
        }
        let options = PHFetchOptions()
        if !parts.isEmpty { options.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: parts) }
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        let found: PHFetchResult<PHAsset>
        if let name = request.string("album") {
            guard let collection = album(name) else { throw PhoneToolError.invalid("This phone has no album \(name). photo_library list_albums gives them.") }
            found = PHAsset.fetchAssets(in: collection, options: options)
        } else {
            found = PHAsset.fetchAssets(with: options)
        }
        let window = PhoneToolShaping.libraryWindow(request, defaultLimit: 30, max: 100)
        let end = min(found.count, window.offset + window.limit)
        let page = window.offset < end ? (window.offset..<end).map { libraryPhoto(found.object(at: $0), filename: false) } : []
        return PhoneToolShaping.libraryPhotos(page, total: found.count, next: end < found.count ? end : nil, limited: limited)
    }

    private static func libraryRead(_ request: PhoneToolRequest, limited: Bool) -> WidgetJSON {
        let ids = PhoneToolShaping.libraryIds(request, max: 50)
        var byId: [String: PHAsset] = [:]
        PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil).enumerateObjects { asset, _, _ in byId[asset.localIdentifier] = asset }
        let page = ids.compactMap { byId[$0].map { libraryPhoto($0, filename: true) } }
        let missing = limited ? "Not found among the photos shared with Sagax on this phone." : "No photo with that id on this phone."
        let failed = ids.filter { byId[$0] == nil }.map { (id: $0, error: missing) }
        return PhoneToolShaping.libraryPhotos(page, total: page.count, next: nil, limited: limited, failed: failed)
    }

    private static func libraryPhoto(_ asset: PHAsset, filename: Bool) -> PhoneLibraryPhoto {
        let media: String = switch asset.mediaType {
        case .image: "photo"
        case .video: "video"
        case .audio: "audio"
        default: "unknown"
        }
        let name = filename ? PHAssetResource.assetResources(for: asset).first?.originalFilename : nil
        return PhoneLibraryPhoto(
            id: asset.localIdentifier, date: asset.creationDate, filename: name, width: asset.pixelWidth, height: asset.pixelHeight,
            favorite: asset.isFavorite, media: media, duration: asset.mediaType == .video ? asset.duration : nil,
            latitude: asset.location?.coordinate.latitude, longitude: asset.location?.coordinate.longitude
        )
    }

    private static func libraryExport(_ request: PhoneToolRequest, limited: Bool) async throws -> WidgetJSON {
        let ids = PhoneToolShaping.libraryIds(request, max: 3)
        guard !ids.isEmpty else { throw PhoneToolError.invalid("photo_library export needs ids.") }
        var byId: [String: PHAsset] = [:]
        PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil).enumerateObjects { asset, _, _ in byId[asset.localIdentifier] = asset }
        var images: [(id: String, jpeg: Data, width: Int, height: Int)] = []
        var failed: [(id: String, error: String)] = []
        let side = PhoneToolShaping.libraryExportSide(original: request.flag("original"))
        for id in ids {
            guard let asset = byId[id] else { failed.append((id: id, error: "No photo with that id on this phone.")); continue }
            guard asset.mediaType == .image else { failed.append((id: id, error: "This is a video: only photos are sent as images.")); continue }
            guard let image = await libraryImage(asset, maxSide: side), let fitted = fittedJPEG(image) else {
                failed.append((id: id, error: "The phone could not load this photo (an original in iCloud that did not download)."))
                continue
            }
            images.append((id: id, jpeg: fitted.data, width: fitted.width, height: fitted.height))
        }
        if images.isEmpty, let first = failed.first { throw PhoneToolError.unavailable(first.error) }
        return PhoneToolShaping.libraryImages(images, failed: failed, limited: limited)
    }

    /// The photo at most maxSide on its longest side, downloaded from
    /// iCloud when the phone keeps only a small copy.
    private static func libraryImage(_ asset: PHAsset, maxSide: Double) async -> UIImage? {
        let size = PhoneToolShaping.scaledSize(width: Double(asset.pixelWidth), height: Double(asset.pixelHeight), maxSide: maxSide)
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.resizeMode = .exact
        options.isNetworkAccessAllowed = true
        return await withCheckedContinuation { done in
            let once = Once()
            PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: size.width, height: size.height), contentMode: .aspectFit, options: options) { image, info in
                if (info?[PHImageResultIsDegradedKey] as? Bool) == true { return }
                guard once.claim() else { return }
                done.resume(returning: image)
            }
        }
    }

    /// A JPEG under the answer's limit: lower quality first, then smaller.
    private static func fittedJPEG(_ image: UIImage) -> (data: Data, width: Int, height: Int)? {
        var current = image
        for _ in 0..<8 {
            for quality in [0.85, 0.7, 0.55] as [CGFloat] {
                if let data = current.jpegData(compressionQuality: quality), PhoneToolShaping.fitsLibraryImage(data) {
                    return (data, Int(current.size.width * current.scale), Int(current.size.height * current.scale))
                }
            }
            let source = current
            let next = CGSize(width: (source.size.width * source.scale * 0.75).rounded(), height: (source.size.height * source.scale * 0.75).rounded())
            let format = UIGraphicsImageRendererFormat.default()
            format.scale = 1
            current = UIGraphicsImageRenderer(size: next, format: format).image { _ in source.draw(in: CGRect(origin: .zero, size: next)) }
        }
        return nil
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

/// Kept until the home list arrives. The phone asks the first time.
private final class HomeLookup: NSObject, HMHomeManagerDelegate {
    private let manager = HMHomeManager()
    private var wait: CheckedContinuation<[HMHome], Error>?

    func load() async throws -> [HMHome] {
        try await withCheckedThrowingContinuation { continuation in
            wait = continuation
            manager.delegate = self
        }
    }

    func homeManagerDidUpdateHomes(_ manager: HMHomeManager) {
        let pending = wait
        wait = nil
        if manager.authorizationStatus == .restricted {
            pending?.resume(throwing: PhoneToolError.permission("Home"))
        } else {
            pending?.resume(returning: manager.homes)
        }
    }
}

/// No extra fields travel with an alarm. The label is the alert title.
@available(iOS 26.0, *)
private struct PhoneAlarmMetadata: AlarmMetadata {}

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
