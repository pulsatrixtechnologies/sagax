// Settings > Bots > Reach me (#1187): the desktop's "Me joindre" card of the
// bot page, on the phone. For each bot, how it reaches this person outside
// the app when a question or an approval waits on them, and when: phone
// notifications, a text message, their own Teams chat, their own Telegram
// bot (WhatsApp later), and hours (ranges of days and times in a time
// zone). Each person chooses for themself, no admin. The contract and the
// draft are CompanionCore's (ReachMe.swift). No id on screen: bots by name,
// the Telegram bot by its @username.
import CompanionCore
import SwiftUI
import UIKit

@MainActor
final class ReachMeModel: ObservableObject {
    enum Load: Equatable { case idle, loading, failed(String), loaded }

    @Published var botId: String?
    @Published var load: Load = .idle
    @Published var draft: ReachMeDraft?
    @Published var busy = false
    @Published var error: String?
    @Published var token = ""
    @Published var telegramLink: URL?
    @Published var telegramError: String?

    private weak var session: Session?

    func attach(_ session: Session) { self.session = session }

    func pick(_ id: String) async {
        guard id != botId || draft == nil else { return }
        botId = id
        draft = nil
        error = nil
        token = ""
        telegramLink = nil
        telegramError = nil
        await reload()
    }

    func reload() async {
        guard let botId, let client = session?.settingsClient else { return }
        load = .loading
        do {
            let view = try await client.reachMe(botId: botId)
            guard botId == self.botId else { return }
            draft = ReachMeDraft(view)
            load = .loaded
        } catch {
            guard botId == self.botId else { return }
            load = .failed(error.localizedDescription)
        }
    }

    func edit(_ change: (inout ReachMeDraft) -> Void) {
        guard var next = draft else { return }
        change(&next)
        draft = next
        error = nil
    }

    func save() async {
        guard let botId, let draft, let client = session?.settingsClient else { return }
        switch draft.payload() {
        case let .failure(problem):
            error = problem == .invalidNumber
                ? String(localized: "Enter your number in international form, like +1 514 555 0123.")
                : String(localized: "Text messages need your own phone number.")
        case let .success(settings):
            busy = true
            defer { busy = false }
            do {
                let view = try await client.saveReachMe(botId: botId, settings: settings)
                self.draft?.accept(view)
                Haptics.selection()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    func cancel() {
        draft?.cancel()
        error = nil
    }

    func connectTelegram() async {
        guard let botId, let client = session?.settingsClient else { return }
        let typed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !typed.isEmpty else { return }
        busy = true
        telegramError = nil
        defer { busy = false }
        do {
            let view = try await client.connectReachTelegram(botId: botId, token: typed)
            token = ""
            telegramLink = view.telegramLink
            draft?.refreshChannels(view)
        } catch {
            telegramError = error.localizedDescription
        }
    }

    func disconnectTelegram() async {
        guard let botId, let client = session?.settingsClient else { return }
        busy = true
        defer { busy = false }
        if let view = try? await client.disconnectReachTelegram(botId: botId) {
            telegramLink = nil
            draft?.refreshChannels(view)
        }
    }
}

struct ReachMeSettingsPage: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @StateObject private var model = ReachMeModel()
    @State private var pickingZone = false
    /// Opened from a bot's profile (#3030): that bot, not the first one.
    var startBotId: String? = nil

    /// The bots this person sees, by name.
    private var bots: [Bot] { session.state.bots.filter { $0.hidden != true } }

    var body: some View {
        SettingsPage(title: "Reach me") {
            botCard
            switch model.load {
            case .idle, .loading:
                ProgressView().tint(Theme.textSecondary).padding(.top, 24)
            case let .failed(message):
                SettingsCard {
                    SettingsRow(title: "Try again", style: .action, identifier: "reach-me-retry") { Task { await model.reload() } }
                }
                Text(verbatim: message)
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 32.67)
                    .padding(.top, 8)
                    .accessibilityIdentifier("reach-me-load-error")
            case .loaded:
                if let draft = model.draft { form(draft) }
            }
        }
        .onAppear { model.attach(session) }
        // the bots arrive with the stream: the first one shown once there is one
        .task(id: bots.first?.id) {
            model.attach(session)
            if model.botId == nil, let start = startBotId { await model.pick(start); return }
            if model.botId == nil, let first = bots.first { await model.pick(first.id) }
        }
        .sheet(isPresented: $pickingZone) {
            ReachMeTimeZonePicker(selected: model.draft?.settings.hours.timeZone ?? TimeZone.current.identifier) { zone in
                model.edit { $0.setTimeZone(zone) }
            }
        }
    }

    // MARK: Bot

    private var botCard: some View {
        VStack(spacing: 0) {
            SettingsCard {
                Menu {
                    ForEach(bots) { bot in
                        Button { Task { await model.pick(bot.id) } } label: {
                            if bot.id == model.botId { Label(bot.name, systemImage: "checkmark") } else { Text(verbatim: bot.name) }
                        }
                    }
                } label: {
                    SettingsRow(title: "Bot", accessory: .valueChevron(bots.first { $0.id == model.botId }?.name ?? String(localized: "No bot")),
                                identifier: "reach-me-bot")
                }
                .accessibilityIdentifier("reach-me-bot-menu")
                .disabled(bots.isEmpty || model.busy)
            }
            SettingsFooter(text: "When this bot has a question or an approval for you, it reaches you here. Answer from there and it continues.")
        }
    }

    // MARK: Form

    /// DEBUG captures only (`-parityReachMeHoursFirst YES`): the hours card
    /// on top, so a headless screenshot shows it without scrolling.
    private var hoursFirst: Bool {
#if DEBUG
        UserDefaults.standard.bool(forKey: "parityReachMeHoursFirst")
#else
        false
#endif
    }

    @ViewBuilder private func form(_ draft: ReachMeDraft) -> some View {
        if hoursFirst {
            hoursCard(draft)
            SettingsSpacer(SettingsMetrics.cardGap)
        }
        SettingsCard {
            ForEach(Array(ReachChannelID.allCases.enumerated()), id: \.element) { index, id in
                if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                channelRow(id, draft)
            }
        }
        if !hoursFirst {
            SettingsSpacer(SettingsMetrics.cardGap)
            hoursCard(draft)
        }
        if let error = model.error {
            Text(verbatim: error)
                .font(Theme.Font.label)
                .foregroundStyle(Theme.danger)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 32.67)
                .padding(.top, 10)
                .accessibilityIdentifier("reach-me-error")
        }
        if draft.dirty {
            HStack(spacing: 10) {
                Button { Task { await model.save() } } label: {
                    Text("Save").font(Theme.Font.buttonLabel).foregroundStyle(Theme.accentInk)
                        .frame(maxWidth: .infinity).frame(height: 40)
                        .background(Theme.accent, in: Capsule())
                }
                .accessibilityIdentifier("reach-me-save")
                Button { model.cancel() } label: {
                    Text("Cancel").font(Theme.Font.buttonLabel).foregroundStyle(Theme.textPrimary)
                        .frame(maxWidth: .infinity).frame(height: 40)
                        .background(Theme.card, in: Capsule())
                }
                .accessibilityIdentifier("reach-me-cancel")
            }
            .buttonStyle(.plain)
            .disabled(model.busy)
            .padding(.horizontal, SettingsMetrics.cardMargin)
            .padding(.top, 16)
        }
    }

    private func label(_ id: ReachChannelID) -> LocalizedStringKey {
        switch id {
        case .push: "Phone notifications"
        case .sms: "Text message"
        case .teams: "Microsoft Teams"
        case .telegram: "Telegram"
        case .whatsapp: "WhatsApp"
        }
    }

    private func help(_ id: ReachChannelID, _ view: ReachMeView) -> String {
        switch id {
        case .push:
            let devices = view.channel(.push).devices ?? 0
            if devices == 1 { return String(localized: "On your paired phone.") }
            return devices > 0 ? String(localized: "On your \(devices) paired phones (iPhone and Android).") : String(localized: "Pair the Sagax app on your phone to get them.")
        case .sms: return String(localized: "From your Perspicax Voice line to your own verified number. Reply with the code.")
        case .teams: return String(localized: "In your own Teams chat, through your engine's connector. Your reply is read for 40 minutes.")
        case .telegram: return String(localized: "With your own Telegram bot, made with BotFather.")
        case .whatsapp:
            return view.offers(.whatsapp)
                ? String(localized: "With your own WhatsApp Business number. Reply with the code.")
                : String(localized: "Coming later.")
        }
    }

    private func notReady(_ id: ReachChannelID) -> LocalizedStringKey {
        switch id {
        case .push: "No phone gets notifications yet."
        case .sms: "Needs your Perspicax Voice line and your own number, verified on it."
        case .teams: "Needs a bot of your own whose engine has a Teams connector."
        case .telegram: "Connect your own Telegram bot."
        case .whatsapp: "Coming later."
        }
    }

    @ViewBuilder private func channelRow(_ id: ReachChannelID, _ draft: ReachMeDraft) -> some View {
        let on = draft.isOn(id)
        let status = draft.view.channel(id)
        VStack(alignment: .leading, spacing: 0) {
            SettingsRow(title: label(id), subtitle: help(id, draft.view),
                        accessory: .toggle(Binding(get: { on }, set: { value in model.edit { $0.set(id, on: value) } })),
                        identifier: "reach-me-\(id.rawValue)")
                .disabled(!draft.view.offers(id) || model.busy)
                .opacity(draft.view.offers(id) ? 1 : 0.55)
            if on, !status.ready, status.reason != nil, id != .telegram, id != .whatsapp {
                note(notReady(id), color: Theme.warning)
                    .accessibilityIdentifier("reach-me-\(id.rawValue)-not-ready")
            }
            if on, id == .sms {
                field {
                    TextField("", text: Binding(get: { model.draft?.phone ?? "" }, set: { value in model.edit { $0.phone = value } }),
                              prompt: Text(verbatim: "+1 514 555 0123").foregroundColor(Theme.placeholder))
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                        .accessibilityLabel(Text("Your phone number"))
                        .accessibilityIdentifier("reach-me-sms-number")
                }
            }
            if on, id == .telegram { telegram(status) }
            if on, id == .whatsapp { whatsApp(status) }
        }
    }

    @ViewBuilder private func telegram(_ status: ReachChannelView) -> some View {
        let name = "@\(status.username ?? "")"
        if status.connected == true {
            HStack(spacing: 10) {
                Text("\(name) connected.").font(Theme.Font.label).foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("reach-me-telegram-connected")
                Spacer(minLength: 8)
                smallButton("Disconnect", identifier: "reach-me-telegram-disconnect") { Task { await model.disconnectTelegram() } }
            }
            .padding(.horizontal, SettingsMetrics.rowInset)
            .padding(.bottom, 12)
        } else if model.telegramLink != nil || status.linking == true {
            VStack(alignment: .leading, spacing: 8) {
                Text("Open \(name) in Telegram and press Start to finish.").font(Theme.Font.label).foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let link = model.telegramLink {
                    Link(destination: link) {
                        Text("Open Telegram").font(Theme.Font.label.weight(.medium)).foregroundStyle(Theme.blue)
                    }
                    .accessibilityIdentifier("reach-me-telegram-open")
                }
            }
            .padding(.horizontal, SettingsMetrics.rowInset)
            .padding(.bottom, 12)
            .accessibilityIdentifier("reach-me-telegram-linking")
        } else {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    field(padded: false) {
                        SecureField("", text: $model.token, prompt: Text("Token from BotFather").foregroundColor(Theme.placeholder))
                            .textContentType(.password)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .accessibilityLabel(Text("Telegram bot token"))
                            .accessibilityIdentifier("reach-me-telegram-token")
                    }
                    smallButton("Connect", identifier: "reach-me-telegram-connect") { Task { await model.connectTelegram() } }
                        .disabled(model.busy || model.token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                if let message = model.telegramError {
                    Text(verbatim: message).font(Theme.Font.label).foregroundStyle(Theme.danger)
                        .accessibilityIdentifier("reach-me-telegram-error")
                }
            }
            .padding(.horizontal, SettingsMetrics.rowInset)
            .padding(.bottom, 12)
        }
    }

    /// WhatsApp (#1247): its state as the server says; connecting the
    /// business number stays on the computer (the bot page).
    @ViewBuilder private func whatsApp(_ status: ReachChannelView) -> some View {
        let name = status.verifiedName ?? status.displayNumber ?? ""
        VStack(alignment: .leading, spacing: 8) {
            if status.connected == true {
                Text("\(name) connected.").foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("reach-me-whatsapp-connected")
                if let number = status.number {
                    Text("Your number: \(number)").foregroundStyle(Theme.textSecondary)
                }
                if !status.ready, let reason = status.reason {
                    Text(verbatim: reason).foregroundStyle(Theme.warning)
                }
            } else if status.linking == true {
                if let sentTo = status.codeSentTo, status.whatsAppLink == nil {
                    Text("A code went to \(sentTo) on WhatsApp: enter it on your computer, on the bot's page.").foregroundStyle(Theme.textSecondary)
                } else {
                    Text("Send the code from your WhatsApp to finish.").foregroundStyle(Theme.textSecondary)
                }
                if let link = status.whatsAppLink {
                    Link(destination: link) {
                        Text("Open WhatsApp").fontWeight(.medium).foregroundStyle(Theme.blue)
                    }
                    .accessibilityIdentifier("reach-me-whatsapp-open")
                }
            } else {
                Text("Connect your WhatsApp Business number on your computer: the bot's page, Reach me.")
                    .foregroundStyle(Theme.warning)
                    .accessibilityIdentifier("reach-me-whatsapp-connect-on-computer")
            }
        }
        .font(Theme.Font.label)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, SettingsMetrics.rowInset)
        .padding(.bottom, 12)
    }

    // MARK: Hours

    @ViewBuilder private func hoursCard(_ draft: ReachMeDraft) -> some View {
        let limited = !draft.settings.hours.isAlways
        SettingsCard {
            SettingsRow(title: "Only during my hours",
                        subtitle: limited ? "Outside these hours, the card waits and goes out when they start." : "Any time.",
                        accessory: .toggle(Binding(get: { limited }, set: { on in
                            model.edit { $0.setLimited(on, localZone: TimeZone.current.identifier) }
                        })),
                        identifier: "reach-me-hours")
                .disabled(model.busy)
            if limited {
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "Time zone", accessory: .valueChevron((draft.settings.hours.timeZone ?? "").replacingOccurrences(of: "_", with: " ")),
                            identifier: "reach-me-time-zone") { pickingZone = true }
                ForEach(Array(draft.settings.hours.rangeList.enumerated()), id: \.offset) { index, range in
                    CardHairline(leadingInset: SettingsMetrics.rowInset)
                    rangeRow(index, range, canRemove: draft.canRemoveRange)
                }
                if draft.canAddRange {
                    CardHairline(leadingInset: SettingsMetrics.rowInset)
                    SettingsRow(title: "Add hours", style: .action, identifier: "reach-me-add-hours") { model.edit { $0.addRange() } }
                }
            }
        }
    }

    private func rangeRow(_ index: Int, _ range: ReachHoursRange, canRemove: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                ForEach(ReachMeRules.days, id: \.self) { day in
                    let on = range.days.contains(day)
                    Button {
                        Haptics.selection()
                        model.edit { $0.toggle(day: day, inRange: index) }
                    } label: {
                        Text(LocalizedStringKey(stringLiteral: "reachMe.day.\(day)"))
                            .font(Theme.Font.labelMedium)
                            .foregroundStyle(on ? Theme.accentInk : Theme.textSecondary)
                            .frame(width: 34, height: 30)
                            .background(on ? Theme.accent : Theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? .isSelected : [])
                    .accessibilityIdentifier("reach-me-range-\(index)-day-\(day)")
                }
            }
            HStack(spacing: 8) {
                clock(range.start, label: "reachMe.start") { value in model.edit { $0.setStart(value, inRange: index) } }
                    .accessibilityIdentifier("reach-me-range-\(index)-start")
                Text("reachMe.to").font(Theme.Font.label).foregroundStyle(Theme.textSecondary)
                clock(range.end, label: "reachMe.end") { value in model.edit { $0.setEnd(value, inRange: index) } }
                    .accessibilityIdentifier("reach-me-range-\(index)-end")
                Spacer(minLength: 4)
                if canRemove {
                    Button("Remove") { model.edit { $0.removeRange(at: index) } }
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("reach-me-range-\(index)-remove")
                }
            }
        }
        .disabled(model.busy)
        .padding(.horizontal, SettingsMetrics.rowInset)
        .padding(.vertical, 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("reach-me-range-\(index)")
    }

    /// An HH:MM time as the system's compact time picker.
    private func clock(_ hhmm: String, label: LocalizedStringKey, set: @escaping (String) -> Void) -> some View {
        let minutes = ReachMeRules.minutes(hhmm) ?? 0
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let base = utc.startOfDay(for: Date(timeIntervalSince1970: 0))
        let binding = Binding<Date>(
            get: { base.addingTimeInterval(TimeInterval(minutes * 60)) },
            set: { date in
                let parts = utc.dateComponents([.hour, .minute], from: date)
                set(ReachMeRules.hhmm((parts.hour ?? 0) * 60 + (parts.minute ?? 0)))
            }
        )
        return DatePicker(label, selection: binding, displayedComponents: .hourAndMinute)
            .labelsHidden()
            .datePickerStyle(.compact)
            .environment(\.timeZone, TimeZone(identifier: "UTC")!)
            .accessibilityLabel(Text(label))
    }

    // MARK: Parts

    private func note(_ text: LocalizedStringKey, color: Color) -> some View {
        Text(text)
            .font(Theme.Font.label)
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, SettingsMetrics.rowInset)
            .padding(.bottom, 10)
    }

    private func field<Content: View>(padded: Bool = true, @ViewBuilder _ content: () -> Content) -> some View {
        content()
            .font(Theme.Font.rowTitle)
            .foregroundStyle(Theme.textPrimary)
            .padding(.horizontal, 12)
            .frame(height: 38)
            .background(Theme.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .padding(.horizontal, padded ? SettingsMetrics.rowInset : 0)
            .padding(.bottom, padded ? 12 : 0)
    }

    private func smallButton(_ title: LocalizedStringKey, identifier: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(Theme.Font.labelMedium).foregroundStyle(Theme.textPrimary)
                .padding(.horizontal, 14).frame(height: 32)
                .background(Theme.inset, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(identifier)
    }
}

/// The zone list of Settings > Time Zone, for one bot's hours.
private struct ReachMeTimeZonePicker: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.dismiss) private var dismiss
    let selected: String
    let pick: (String) -> Void
    @State private var query = ""

    private var zones: [String] {
        let all = TimeZone.knownTimeZoneIdentifiers.sorted()
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return all }
        let needle = trimmed.replacingOccurrences(of: " ", with: "_")
        return all.filter { $0.localizedCaseInsensitiveContains(needle) || $0.localizedCaseInsensitiveContains(trimmed) }
    }

    var body: some View {
        SettingsPage(title: "Time zone", leading: .close({ dismiss() }), contentTop: 70, scrollable: false) {
            VStack(spacing: 10) {
                SettingsSearchField(prompt: "Search time zones", text: $query, identifier: "reach-me-time-zone-search")
                    .padding(.horizontal, SettingsMetrics.headerInset)
                List {
                    ForEach(zones, id: \.self) { zone in
                        Button {
                            Haptics.selection()
                            pick(zone)
                            dismiss()
                        } label: {
                            HStack {
                                Text(verbatim: zone.replacingOccurrences(of: "_", with: " "))
                                    .font(Theme.Font.rowTitle)
                                    .foregroundStyle(Theme.textPrimary)
                                Spacer()
                                if zone == selected {
                                    Image(systemName: "checkmark").font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.textPrimary)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(Theme.card)
                        .listRowSeparatorTint(Theme.hairline)
                        .accessibilityIdentifier("reach-me-time-zone.\(zone)")
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .scrollDismissesKeyboard(.immediately)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }
}
