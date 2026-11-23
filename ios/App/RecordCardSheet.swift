// The card a record's chip opens (#4572, lot S3), on iPhone and iPad.
//
// One sheet, one card, built once for every kind: it names no product and no
// kind and branches on neither. It reads only the four tones, the four levels,
// the two roles `owner` and `contact`, the four date keys and the nine field
// types of the contract (shared/record-cards.ts), so a new kind is data in a
// product's guide and nothing here. The layout is the stacked one of the
// desktop card: the head (mark, kind, number, state), the title, the facts as
// rows, then the description, the lines and the activity, then the actions as
// rows. A record the card names (its company, a `ref` field, a person, a
// line) is a row that pushes that record's card in this sheet, with a Back
// arrow; the trail holds eight records at most. A record whose product the
// person does not hold is plain words, never a row. Every read is the signed-in
// person's own: the card shows what their access allows.
import SwiftUI
import UIKit
import CompanionCore

private struct RecordAskKey: EnvironmentKey {
    static let defaultValue: ((String) -> Void)? = nil
}

extension EnvironmentValues {
    /// Puts a record's markdown link into the chat composer (desktop "Ask").
    /// Nil when this card has no composer to write to.
    var recordAsk: ((String) -> Void)? {
        get { self[RecordAskKey.self] }
        set { self[RecordAskKey.self] = newValue }
    }
}

/// What a chip tap opens: the record and the words the chip wore.
struct RecordSheetItem: Identifiable, Equatable {
    let id = UUID()
    let ref: RecordRef
    /// The words the chip wore (nil: the kind's name alone)
    let label: String?
}

struct RecordCardSheet: View {
    @Environment(\.themePalette) private var themePalette
    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    @Environment(\.recordAsk) private var recordAsk
    @EnvironmentObject private var session: Session

    let start: RecordSheetItem
    /// The clock, for a capture that holds time still.
    var now: Date? = nil

    /// The records opened one from another: the last one is on screen.
    @State private var trail: [RecordSheetItem] = []
    @State private var answers: [RecordRef: RecordCardAnswer] = [:]
    @State private var loading: Set<RecordRef> = []
    @State private var products = RecordProducts()
    @State private var copied = false

    /// The trail's depth: eight records, the oldest dropped.
    static let trailMax = 8

    private var shown: RecordSheetItem { trail.last ?? start }
    private var language: String { locale.identifier }
    private var clock: Date { now ?? Date() }

    var body: some View {
        VStack(spacing: 0) {
            bar
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    content
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 28)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .task {
            if trail.isEmpty { trail = [start] }
            products = await session.recordProducts(language: language)
        }
        .task(id: shown.ref) { await load(shown.ref) }
    }

    // MARK: - Bar

    private var bar: some View {
        HStack(spacing: 8) {
            if trail.count > 1 {
                Button { back() } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(width: 36, height: 36)
                        .contentShape(Rectangle())
                        // the identifier rides on the label: an image's own name wins over a button's
                        .accessibilityIdentifier("record-card-back")
                }
                .foregroundStyle(Theme.textPrimary)
                .accessibilityLabel(Text("Back"))
            }
            Text(verbatim: barTitle)
                .font(Theme.Font.headerTitle)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: trail.count > 1 ? .leading : .center)
                .accessibilityAddTraits(.isHeader)
            Button { dismiss() } label: {
                Text("Done").font(Theme.Font.buttonLabel).accessibilityIdentifier("record-card-done")
            }
            .foregroundStyle(Theme.blue)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 48)
    }

    private var barTitle: String {
        if case let .card(card)? = answers[shown.ref] { return "\(card.kind.name) \(card.number)" }
        let kind = products.kindName(shown.ref) ?? String(localized: "Record")
        return shown.label.map { "\(kind) \($0)" } ?? kind
    }

    // MARK: - Reading

    private func load(_ ref: RecordRef, fresh: Bool = false) async {
        if !fresh, answers[ref] != nil { return }
        loading.insert(ref)
        let answer = await session.recordCard(ref, language: language, fresh: fresh)
        answers[ref] = answer
        loading.remove(ref)
    }

    private func open(_ ref: RecordRef, label: String) {
        guard products.canOpen(ref) else { return }
        var next = trail.isEmpty ? [start] : trail
        next.append(RecordSheetItem(ref: ref, label: label))
        if next.count > Self.trailMax { next.removeFirst(next.count - Self.trailMax) }
        trail = next
    }

    private func back() {
        guard trail.count > 1 else { return }
        trail.removeLast()
    }

    // MARK: - Content

    @ViewBuilder private var content: some View {
        switch answers[shown.ref] {
        case let .card(card)?:
            cardBody(card)
        case let .miss(miss)?:
            missBody(miss)
        case nil:
            skeleton
        }
    }

    private var skeleton: some View {
        VStack(alignment: .leading, spacing: 12) {
            RoundedRectangle(cornerRadius: 6).fill(Theme.inset).frame(width: 220, height: 20)
            RoundedRectangle(cornerRadius: 12).fill(Theme.inset).frame(height: 160)
        }
        .redacted(reason: .placeholder)
        .accessibilityLabel(Text("Loading the record"))
        .accessibilityIdentifier("record-card-loading")
    }

    // MARK: A card

    @ViewBuilder private func cardBody(_ card: RecordCard) -> some View {
        head(card)
        let rows = factRows(card)
        if !rows.isEmpty {
            group { ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                if index > 0 { separator }
                row
            } }
        }
        if let description = card.description {
            section(nil) {
                Text(verbatim: description.text)
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        if let lines = card.lines { linesSection(lines) }
        notesSection(card.notes)
        actions(card)
    }

    private func head(_ card: RecordCard) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                ProductMark(name: card.product.name, iconURL: card.product.icon?.url)
                Text(verbatim: card.product.name)
                    .font(Theme.Font.profileLabel)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }
            Text(verbatim: card.title)
                .font(Theme.font(20, .semibold))
                .foregroundStyle(Theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("record-card-title")
            let chips = headChips(card)
            if !chips.isEmpty {
                ChatWidgetFlow(spacing: 6) {
                    ForEach(Array(chips.enumerated()), id: \.offset) { _, chip in
                        ToneChip(label: chip.label, tone: chip.tone)
                    }
                }
            }
        }
    }

    private func headChips(_ card: RecordCard) -> [(label: String, tone: String)] {
        var chips: [(String, String)] = []
        if let state = card.state { chips.append((state.label, state.tone)) }
        if let priority = card.priority { chips.append((priority.label, priority.level == "urgent" ? "alert" : priority.level == "high" ? "waiting" : "open")) }
        for chip in card.chips ?? [] { chips.append((chip.label, chip.tone)) }
        return chips
    }

    // MARK: Facts

    private func factRows(_ card: RecordCard) -> [AnyView] {
        var rows: [AnyView] = []
        let tz = card.tz
        let late = card.dates?["due"].flatMap { due -> String? in
            card.state?.tone == "done" ? nil : RecordCardFormat.lateness(due, now: clock, lang: language, tz: tz)
        }
        if let company = card.company {
            rows.append(AnyView(factRow("Company") { refValue(name: company.name, detail: nil, ref: company.ref, icon: "building.2") }))
        }
        for person in card.people ?? [] {
            let label = person.label.isEmpty ? personLabel(person.role) : person.label
            rows.append(AnyView(factRow(Text(verbatim: label)) { refValue(name: person.name, detail: person.detail, ref: person.ref, icon: personIcon(person.role)) }))
        }
        if let priority = card.priority {
            rows.append(AnyView(factRow("Priority") { Text(verbatim: priority.label).font(Theme.Font.body).foregroundStyle(Theme.textPrimary) }))
        }
        let dates: [(String, LocalizedStringKey, Bool)] = [("opened", "Opened", true), ("updated", "Last updated", true), ("due", "Due", false), ("closed", "Closed", false)]
        for (key, label, relative) in dates {
            guard let value = card.dates?[key] else { continue }
            rows.append(AnyView(factRow(label) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: relative ? RecordCardFormat.relative(value, now: clock, lang: language, tz: tz) : RecordCardFormat.absolute(value, now: clock, lang: language, tz: tz))
                        .font(Theme.Font.body).foregroundStyle(Theme.textPrimary)
                    if key == "due", let late {
                        Label { Text("\(late) late") } icon: { Image(systemName: "exclamationmark.circle.fill") }
                            .font(Theme.Font.profileLabel).foregroundStyle(Theme.danger)
                    }
                }
            }))
        }
        for field in card.fields ?? [] {
            rows.append(AnyView(factRow(Text(verbatim: field.label)) { fieldValue(field, tz: tz) }))
        }
        return rows
    }

    private func personLabel(_ role: String) -> String {
        role == "owner" ? String(localized: "Owner") : String(localized: "Contact")
    }

    private func personIcon(_ role: String) -> String {
        role == "owner" ? "person.fill.checkmark" : "person.fill"
    }

    @ViewBuilder private func fieldValue(_ field: RecordCard.Field, tz: String?) -> some View {
        switch field.type {
        case "date"?:
            Text(verbatim: field.at.map { RecordCardFormat.absolute($0, now: clock, lang: language, tz: tz, time: field.day != true) } ?? field.value)
                .font(Theme.Font.body).foregroundStyle(Theme.textPrimary)
        case "ago"?:
            Text(verbatim: field.at.map { RecordCardFormat.relative($0, now: clock, lang: language, tz: tz) } ?? field.value)
                .font(Theme.Font.body).foregroundStyle(Theme.textPrimary)
                .accessibilityHint(Text(verbatim: field.at.map { RecordCardFormat.full($0, lang: language, tz: tz) } ?? ""))
        case "money"?:
            // the product's own text, exactly as sent
            Text(verbatim: field.value).font(Theme.Font.body).monospacedDigit().foregroundStyle(Theme.textPrimary)
        case "duration"?:
            Text(verbatim: field.value).font(Theme.Font.body).monospacedDigit().foregroundStyle(Theme.textPrimary)
        case "percent"?:
            HStack(spacing: 8) {
                ProgressBar(share: field.share ?? 0)
                Text(verbatim: field.value).font(Theme.Font.body).monospacedDigit().foregroundStyle(Theme.textPrimary)
            }
        case "person"?:
            refValue(name: field.value, detail: field.detail, ref: field.ref, icon: personIcon(field.role ?? ""))
        case "ref"?:
            refValue(name: field.value, detail: field.detail, ref: field.ref, icon: nil)
        case "state"?:
            ToneChip(label: field.value, tone: field.tone ?? "open")
        default:
            Text(verbatim: field.value).font(Theme.Font.body).foregroundStyle(Theme.textPrimary)
        }
    }

    /// A name that opens another card when the person holds its product, plain words otherwise.
    @ViewBuilder private func refValue(name: String, detail: String?, ref: RecordRef?, icon: String?) -> some View {
        let words = HStack(alignment: .firstTextBaseline, spacing: 6) {
            if let icon { Image(systemName: icon).font(.system(size: 12)).foregroundStyle(Theme.textSecondary) }
            Text(verbatim: name).font(Theme.Font.body)
            if let detail { Text(verbatim: detail).font(Theme.Font.profileLabel).foregroundStyle(Theme.textSecondary) }
        }
        if let ref, products.canOpen(ref) {
            Button { open(ref, label: name) } label: {
                HStack(spacing: 4) {
                    words.foregroundStyle(Theme.blue)
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.chevron)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(Text("Opens this record"))
            .accessibilityIdentifier("record-ref-\(ref.kind)-\(ref.id)")
        } else {
            words.foregroundStyle(Theme.textPrimary)
        }
    }

    // MARK: Right pane

    @ViewBuilder private func linesSection(_ lines: RecordCard.Lines) -> some View {
        switch lines.state {
        case "forbidden":
            note("Your access does not include the lines.")
        case "unavailable":
            note("The lines could not be read right now.")
        case "ok" where !lines.items.isEmpty:
            section(lines.title) {
                VStack(spacing: 0) {
                    ForEach(Array(lines.items.enumerated()), id: \.offset) { index, line in
                        if index > 0 { separator }
                        lineRow(line)
                    }
                    if lines.more {
                        separator
                        let others = max(1, (lines.total ?? lines.items.count + 1) - lines.items.count)
                        HStack(spacing: 8) {
                            (others == 1 ? Text("1 other line") : Text("\(others) other lines"))
                                .font(Theme.Font.profileLabel).foregroundStyle(Theme.textSecondary)
                            seeAll
                        }
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
                    }
                }
            }
        default:
            EmptyView()
        }
    }

    @ViewBuilder private func lineRow(_ line: RecordCard.Line) -> some View {
        let row = HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(verbatim: line.label).font(Theme.Font.body).frame(maxWidth: .infinity, alignment: .leading)
            if let detail = line.detail { Text(verbatim: detail).font(Theme.Font.profileLabel).foregroundStyle(Theme.textSecondary).monospacedDigit() }
            if let value = line.value { Text(verbatim: value).font(Theme.Font.body).monospacedDigit() }
        }
        .padding(.vertical, 8)
        if let ref = line.ref, products.canOpen(ref) {
            Button { open(ref, label: line.label) } label: {
                HStack { row.foregroundStyle(Theme.blue); Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.chevron) }
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        } else {
            row.foregroundStyle(Theme.textPrimary)
        }
    }

    @ViewBuilder private func notesSection(_ notes: RecordCard.Notes) -> some View {
        switch notes.state {
        case "forbidden":
            note("Your access does not include the notes.")
        case "unavailable":
            note("The notes could not be read right now.")
        case "ok" where !notes.items.isEmpty:
            let count = notes.total ?? notes.items.count
            section(notes.title.map { "\($0) (\(count))" } ?? String(localized: "Notes (\(count))")) {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(notes.items.enumerated()), id: \.offset) { _, item in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) {
                                if let author = item.author { Text(verbatim: author).font(Theme.Font.profileLabel).fontWeight(.medium) }
                                if let at = item.at {
                                    Text(verbatim: RecordCardFormat.relative(at, now: clock, lang: language, tz: nil)).font(Theme.Font.profileLabel).foregroundStyle(Theme.textSecondary)
                                }
                                if let tag = item.tag { Text(verbatim: tag).font(Theme.Font.label).foregroundStyle(Theme.textSecondary) }
                                if item.isInternal == true {
                                    Label { Text("Internal") } icon: { Image(systemName: "lock.fill") }
                                        .font(Theme.Font.label).foregroundStyle(Theme.textSecondary)
                                } else if item.isInternal == false {
                                    Label { Text("External") } icon: { Image(systemName: "globe") }
                                        .font(Theme.Font.label).foregroundStyle(Theme.textSecondary)
                                }
                            }
                            Text(verbatim: item.text).font(Theme.Font.body).foregroundStyle(Theme.textPrimary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if notes.more {
                        let others = max(1, (notes.total ?? notes.items.count + 1) - notes.items.count)
                        HStack(spacing: 8) {
                            (others == 1 ? Text("1 other note") : Text("\(others) other notes"))
                                .font(Theme.Font.profileLabel).foregroundStyle(Theme.textSecondary)
                            seeAll
                        }
                    }
                }
            }
        default:
            EmptyView()
        }
    }

    private var openAddress: URL? {
        if case let .card(card)? = answers[shown.ref] { return card.openUrl.flatMap(URL.init(string:)) }
        return nil
    }

    /// "See all": the record in its product (the same address as "Open in"), when the card has one.
    @ViewBuilder private var seeAll: some View {
        if let url = openAddress {
            Button { UIApplication.shared.open(url) } label: { Text("See all").font(Theme.Font.profileLabel).foregroundStyle(Theme.blue) }
                .buttonStyle(.plain)
                .accessibilityIdentifier("record-card-see-all")
        }
    }

    private func note(_ key: LocalizedStringKey) -> some View {
        Text(key).font(Theme.Font.profileLabel).foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Actions

    @ViewBuilder private func actions(_ card: RecordCard) -> some View {
        group {
            if let url = card.openUrl.flatMap(URL.init(string:)) {
                Button { UIApplication.shared.open(url) } label: {
                    actionRow(icon: "arrow.up.right", Text("Open in \(card.product.name)"), primary: true)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("record-card-open")
                separator
            }
            if recordAsk != nil {
                Button {
                    let words = shown.label.flatMap { $0.isEmpty ? nil : $0 } ?? card.number
                    recordAsk?(RecordLinks.markdown(label: words, ref: card.ref))
                    dismiss()
                } label: {
                    actionRow(icon: "text.bubble", Text("Ask"), primary: false)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("record-card-ask")
                separator
            }
            Button {
                UIPasteboard.general.string = card.number
                copied = true
                Task { try? await Task.sleep(nanoseconds: 1_500_000_000); copied = false }
            } label: {
                actionRow(icon: copied ? "checkmark" : "doc.on.doc", copied ? Text("Copied") : Text("Copy the number"), primary: false)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("record-card-copy")
            separator
            Button { Task { await load(card.ref, fresh: true) } } label: {
                actionRow(icon: "arrow.clockwise", Text("Refresh"), primary: false)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("record-card-refresh")
        }
        if let asOf = card.asOf {
            Text("Up to date at \(RecordCardFormat.clockText(asOf, lang: language, tz: card.tz))")
                .font(Theme.Font.profileLabel).foregroundStyle(Theme.textTertiary)
                .frame(maxWidth: .infinity, alignment: .center)
        }
    }

    private func actionRow(icon: String, _ label: Text, primary: Bool) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 14, weight: .medium)).frame(width: 20)
            label.font(Theme.Font.body)
            Spacer(minLength: 0)
        }
        .foregroundStyle(primary ? Theme.blue : Theme.textPrimary)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }

    // MARK: A card that did not come

    @ViewBuilder private func missBody(_ miss: RecordCardMiss) -> some View {
        let product = products.product(shown.ref.product)?.name ?? String(localized: "This product")
        VStack(alignment: .leading, spacing: 12) {
            Label { Text(verbatim: missSentence(miss, product: product)) } icon: { Image(systemName: miss.state == "org_refused" ? "exclamationmark.shield" : "exclamationmark.circle") }
                .font(Theme.Font.body).foregroundStyle(Theme.textPrimary)
                .accessibilityIdentifier("record-card-miss")
            if let rule = miss.rule {
                Text(verbatim: rule.text).font(Theme.Font.profileLabel).foregroundStyle(Theme.textSecondary)
            }
            if miss.state == "down" || miss.state == "busy" {
                Button { Task { await load(shown.ref, fresh: true) } } label: { Text("Retry").font(Theme.Font.buttonLabel) }
                    .foregroundStyle(Theme.blue)
                    .accessibilityIdentifier("record-card-retry")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 8)
    }

    private func missSentence(_ miss: RecordCardMiss, product: String) -> String {
        switch miss.state {
        case "sign_in": String(localized: "Sign in again to read this record.")
        case "no_access": String(localized: "You have no access to this record.")
        case "unknown": String(localized: "This record was not found, or it is outside your access.")
        case "not_connected": String(localized: "\(product) is not connected for you.")
        case "busy": String(localized: "\(product) is busy. Trying again shortly.")
        case "down": String(localized: "\(product) is not answering right now.")
        case "org_refused": String(localized: "Your organization blocks this read.")
        default: String(localized: "Record cards are not available here.")
        }
    }

    // MARK: Parts

    private var separator: some View {
        Rectangle().fill(Theme.hairline).frame(height: 0.5)
    }

    private func group<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) { content() }
            .padding(.horizontal, 14)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    @ViewBuilder private func section<Content: View>(_ title: String?, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title {
                Text(verbatim: title).font(Theme.Font.profileLabel).fontWeight(.medium).foregroundStyle(Theme.textSecondary)
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func factRow<Value: View>(_ label: LocalizedStringKey, @ViewBuilder _ value: () -> Value) -> some View {
        factRow(Text(label), value)
    }

    private func factRow<Value: View>(_ label: Text, @ViewBuilder _ value: () -> Value) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            label.font(Theme.Font.profileLabel).foregroundStyle(Theme.textSecondary)
                .frame(width: 104, alignment: .leading)
            value().frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 11)
    }
}

// MARK: - Small views

/// The product's mark: its own icon when the card came with one, else a tile
/// with the product's first letter.
private struct ProductMark: View {
    let name: String
    let iconURL: String?

    var body: some View {
        Group {
            if let iconURL, let url = URL(string: iconURL) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image { image.resizable().scaledToFit() } else { letter }
                }
            } else {
                letter
            }
        }
        .frame(width: 18, height: 18)
        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        .accessibilityHidden(true)
    }

    private var letter: some View {
        ZStack {
            Theme.inset
            Text(verbatim: String(name.first.map { Character($0.uppercased()) } ?? "?")).font(Theme.font(10, .semibold)).foregroundStyle(Theme.textSecondary)
        }
    }
}

/// A chip in the tone's own tint, its words in the ink: the tone is a dot.
private struct ToneChip: View {
    let label: String
    let tone: String

    private var dot: Color {
        switch tone {
        case "waiting": Theme.warning
        case "done": Theme.success
        case "alert": Theme.danger
        default: Theme.textSecondary
        }
    }

    private var fill: Color {
        switch tone {
        case "waiting": Theme.warning.opacity(0.15)
        case "done": Theme.success.opacity(0.15)
        case "alert": Theme.danger.opacity(0.15)
        default: Theme.inset
        }
    }

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(dot).frame(width: 6, height: 6)
            Text(verbatim: label).font(Theme.Font.roleChip).foregroundStyle(Theme.textPrimary).lineLimit(1)
        }
        .padding(.horizontal, 9)
        .frame(height: 24)
        .background(fill, in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

private struct ProgressBar: View {
    let share: Double

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.inset)
                Capsule().fill(Theme.accent).frame(width: geometry.size.width * CGFloat(min(max(share, 0), 100) / 100))
            }
        }
        .frame(height: 4)
        .frame(minWidth: 32, maxWidth: .infinity)
        .accessibilityElement()
        .accessibilityValue(Text("\(Int(share)) percent"))
    }
}
