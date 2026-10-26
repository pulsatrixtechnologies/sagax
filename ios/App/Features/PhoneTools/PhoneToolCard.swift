// The card a phone tool request shows on this iPhone: which bot, what it
// wants to read or change, why (the bot's own words), and the approval
// card's three choices: Refuser / Toujours permettre / Permettre une fois.
// Toujours permettre is absent where it never applies (a shortcut, the
// clipboard, photos). Photos: Permettre une fois opens the picker; what the
// person picks is the answer.
import CompanionCore
import PhotosUI
import SwiftUI
import UIKit

struct PhoneToolCard: View {
    let request: PhoneToolRequest
    /// The clipboard's text, read before the card showed (only this goes).
    var clipboardPreview: String?
    /// HTTPS or Tailscale: a scanned card number never crosses cleartext Wi-Fi.
    var protectedTransport = true
    @State private var picking = false
    @State private var picked: [PhotosPickerItem] = []
    @State private var working = false

    var body: some View {
        if request.tool == .cardScan {
            PhoneCardScanCard(request: request, protectedTransport: protectedTransport)
        } else {
            toolCard
        }
    }

    private var toolCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Image(systemName: PhoneToolWords.symbol(request.tool))
                    .font(.title2)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Color.accentColor.opacity(0.15)))
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: request.botName.isEmpty ? String(localized: "A bot") : request.botName)
                        .font(.headline)
                    Text("Wants to use a tool on your phone")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            Text(PhoneToolWords.what(request))
                .font(.body)
                .fixedSize(horizontal: false, vertical: true)
            if let reason = request.reason {
                Text(verbatim: "« \(reason) »")
                    .font(.callout)
                    .italic()
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            // every field of what would be created, a shortcut's whole input
            let details = PhoneToolDetails.fields(request)
            if !details.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(details, id: \.key) { field in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(PhoneToolWords.fieldLabel(field.key)).font(.caption).foregroundStyle(.secondary)
                            Text(verbatim: PhoneToolWords.fieldValue(field))
                                .font(.callout)
                                .textSelection(.enabled)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            if PhoneToolDetails.warnsOfSideEffects(request) {
                Label("This shortcut can send messages, pay or change things on your behalf.", systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(Theme.danger)
            }
            if request.tool == .clipboard {
                VStack(alignment: .leading, spacing: 2) {
                    Text("What would be sent").font(.caption).foregroundStyle(.secondary)
                    Text(verbatim: clipboardPreview ?? String(localized: "The clipboard holds no text."))
                        .font(.callout.monospaced())
                        .lineLimit(6)
                }
            }
            if request.writes {
                Label("This changes something on your phone.", systemImage: "square.and.pencil")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            VStack(spacing: 10) {
                ForEach(PhoneToolRules.choices(for: request), id: \.rawValue) { choice in
                    button(choice)
                }
            }
            .disabled(working)
        }
        .padding(20)
        .photosPicker(isPresented: $picking, selection: $picked, maxSelectionCount: max(1, min(request.int("max") ?? 1, 3)), matching: .images)
        .onValueChange(of: picking) { open in
            // closed without a pick: nothing goes, the card stays
            if !open && picked.isEmpty { working = false }
        }
        .onValueChange(of: picked) { items in
            guard !items.isEmpty else { return }
            working = true
            Task {
                let jpegs = await PhoneToolPhotos.jpegs(items)
                await PhoneToolCenter.shared.choose(.once, photos: jpegs)
            }
        }
    }

    @ViewBuilder
    private func button(_ choice: PhoneToolRules.Choice) -> some View {
        switch choice {
        case .deny:
            Button(role: .cancel) { answer(.deny) } label: {
                Text("Deny").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
        case .always:
            Button { answer(.always) } label: {
                Text("Always allow").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
        case .once:
            Button { request.tool == .photos ? (picking = true) : answer(.once) } label: {
                Text(request.tool == .photos ? "Choose photos" : "Allow once").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
    }

    private func answer(_ choice: PhoneToolRules.Choice) {
        working = true
        Task { await PhoneToolCenter.shared.choose(choice) }
    }
}

/// The words of each tool, in the phone's language.
enum PhoneToolWords {
    static func symbol(_ tool: PhoneTool?) -> String {
        switch tool {
        case .location: "location.fill"
        case .contacts: "person.crop.circle"
        case .reminders: "checklist"
        case .calendar: "calendar"
        case .photos: "photo.on.rectangle"
        case .shortcut: "square.stack.3d.up"
        case .clipboard: "doc.on.clipboard"
        case .status: "battery.75percent"
        case .cardScan: "creditcard.viewfinder"
        case nil: "questionmark.circle"
        }
    }

    static func name(_ tool: PhoneTool) -> String {
        switch tool {
        case .location: String(localized: "Location")
        case .contacts: String(localized: "Contacts")
        case .reminders: String(localized: "Reminders")
        case .calendar: String(localized: "Calendar")
        case .photos: String(localized: "Photos")
        case .shortcut: String(localized: "Shortcuts")
        case .clipboard: String(localized: "Clipboard")
        case .status: String(localized: "Battery, network and Focus")
        case .cardScan: String(localized: "Scan a card for your computer")
        }
    }

    static func what(_ request: PhoneToolRequest) -> String {
        switch request.tool {
        case .location:
            return request.flag("precise") ? String(localized: "Your exact position, once.") : String(localized: "Your approximate position (about 100 m), once.")
        case .contacts:
            let query = request.string("query") ?? ""
            let fields = PhoneToolShaping.contactFields.filter(PhoneToolShaping.requestedFields(request).contains).map(field).joined(separator: ", ")
            return String(localized: "Search “\(query)” in your contacts and send: \(fields).")
        case .reminders:
            if request.action == "create" { return String(localized: "Add the reminder “\(request.string("title") ?? "")”.") }
            return String(localized: "Read your reminders that are not done.")
        case .calendar:
            if request.action == "create" {
                let start = PhoneToolShaping.date(request.string("start")).map { $0.formatted(date: .abbreviated, time: .shortened) } ?? ""
                return String(localized: "Add “\(request.string("title") ?? "")” to your calendar, \(start).")
            }
            let from = PhoneToolShaping.date(request.string("from")).map { $0.formatted(date: .abbreviated, time: .omitted) } ?? ""
            let to = PhoneToolShaping.date(request.string("to")).map { $0.formatted(date: .abbreviated, time: .omitted) } ?? ""
            return String(localized: "Read your calendar from \(from) to \(to).")
        case .photos:
            return String(localized: "Pick up to \(max(1, min(request.int("max") ?? 1, 3))) photos to send.")
        case .shortcut:
            return String(localized: "Run your shortcut “\(request.string("name") ?? "")”.")
        case .clipboard:
            return String(localized: "Read the text on your clipboard.")
        case .status:
            return String(localized: "Read the battery, the network and whether a Focus is on.")
        case .cardScan:
            return String(localized: "Your computer asks to scan a payment card. The number, the expiry and the name go to its New card form; the security code is never read.")
        case nil:
            return String(localized: "This version of Sagax does not know this tool. Update the app to use it.")
        }
    }

    static func fieldLabel(_ key: String) -> String {
        switch key {
        case "title": String(localized: "Title")
        case "due": String(localized: "Due")
        case "list": String(localized: "List")
        case "notes": String(localized: "Notes")
        case "start": String(localized: "Starts")
        case "end": String(localized: "Ends")
        case "location": String(localized: "Place")
        case "name": String(localized: "Shortcut")
        default: String(localized: "Text sent to the shortcut")
        }
    }

    /// Dates in the phone's own words; the rest as the bot wrote it.
    static func fieldValue(_ field: PhoneToolDetails.Field) -> String {
        if ["due", "start", "end"].contains(field.key), let date = PhoneToolShaping.date(field.value) {
            return date.formatted(date: .abbreviated, time: .shortened)
        }
        return field.value
    }

    private static func field(_ name: String) -> String {
        switch name {
        case "phone": String(localized: "phone")
        case "email": String(localized: "email")
        case "address": String(localized: "address")
        case "birthday": String(localized: "birthday")
        default: String(localized: "organization")
        }
    }
}

/// Picked photos, downscaled to PhoneToolShaping.photoMaxSide and JPEG.
enum PhoneToolPhotos {
    static func jpegs(_ items: [PhotosPickerItem]) async -> [Data] {
        var out: [Data] = []
        for item in items.prefix(3) {
            guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else { continue }
            let size = PhoneToolShaping.scaledSize(width: image.size.width, height: image.size.height)
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            let scaled = UIGraphicsImageRenderer(size: CGSize(width: size.width, height: size.height), format: format).image { _ in
                image.draw(in: CGRect(x: 0, y: 0, width: size.width, height: size.height))
            }
            if let jpeg = scaled.jpegData(compressionQuality: 0.7) { out.append(jpeg) }
        }
        return out
    }
}

/// "Scanner avec l'iPhone" (audit row 84): the computer's New card form
/// asked. The card is read on this phone (CardPhotoScanner, Vision); the
/// person sees what was read before it goes, and only the number, the
/// expiry and the name go. Never over cleartext Wi-Fi.
private struct PhoneCardScanCard: View {
    let request: PhoneToolRequest
    let protectedTransport: Bool
    @State private var read: CardScanResult?
    @State private var working = false

    private var publicKey: String? { request.string("publicKey") }
    private var matchCode: String? { publicKey.flatMap { try? PhoneCardSeal.matchCode($0) } }

    /// Sealed here for the form's one-time key (JC 2026-10-21): the server
    /// relays the envelope and never sees the number.
    private func send(number: String, read: CardScanResult) async {
        guard let publicKey else { return await PhoneToolCenter.shared.choose(.deny) }
        guard #available(iOS 17.0, *) else {
            return await PhoneToolCenter.shared.refuse(String(localized: "This iPhone needs iOS 17 to seal a card for your computer."))
        }
        do {
            let sealed = try PhoneCardSeal.seal(number: number, expMonth: read.expMonth, expYear: read.expYear, holder: read.holder, publicKey: publicKey, requestId: request.id)
            await PhoneToolCenter.shared.choose(.once, card: sealed)
        } catch {
            await PhoneToolCenter.shared.refuse(String(localized: "The card could not be sealed for the computer."))
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Image(systemName: PhoneToolWords.symbol(.cardScan))
                    .font(.title2)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Color.accentColor.opacity(0.15)))
                Text("Scan a card for your computer").font(.headline)
            }
            Text(PhoneToolWords.what(request))
                .fixedSize(horizontal: false, vertical: true)
            if let code = matchCode, protectedTransport {
                // a pairing check (the right form, the right phone), not an authentication
                Text("Pairing code \(String(code.prefix(3))) \(String(code.suffix(3))): your computer's form shows the same when it is the one asking.")
                    .font(.callout.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if matchCode == nil {
                Text("This request cannot be sealed for your computer. Ask again from the New card form.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else if !protectedTransport {
                Text("This needs a secure connection (HTTPS or Tailscale). Type the card on your computer instead.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let read, let number = read.pan {
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: PhoneToolShaping.maskedNumber(number)).font(.body.monospacedDigit())
                    if let month = read.expMonth, let year = read.expYear {
                        Text(verbatim: String(format: "%02d/%d", month, year)).foregroundStyle(.secondary)
                    }
                    if let holder = read.holder { Text(verbatim: holder).foregroundStyle(.secondary) }
                }
                Button {
                    working = true
                    Task { await send(number: number, read: read) }
                } label: {
                    Text("Send to the computer").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(working)
            } else {
                CardPhotoScanner { result in read = result }
            }
            Spacer(minLength: 0)
            Button(role: .cancel) {
                working = true
                Task { await PhoneToolCenter.shared.choose(.deny) }
            } label: {
                Text("Deny").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .disabled(working)
        }
        .padding(20)
    }
}
