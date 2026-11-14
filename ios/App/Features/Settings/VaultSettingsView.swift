import CompanionCore
import SwiftUI

/// Settings > Vault: the person's cards, addresses, contacts and logins.
/// A number is shown only after Face ID. Filter pills match the desktop
/// vault tabs (All / Logins / Payments / Contacts). Purchases answer with
/// Cancel / Pay (deny / once).
struct VaultSettingsView: View {
    private enum Filter: String, CaseIterable, Identifiable {
        case all, logins, payments, contacts
        var id: String { rawValue }

        var title: String {
            switch self {
            case .all: String(localized: "All")
            case .logins: String(localized: "Logins")
            case .payments: String(localized: "Payments")
            case .contacts: String(localized: "Contacts")
            }
        }
    }

    @EnvironmentObject private var session: Session
    @State private var filter: Filter = .all
    @State private var items: [VaultItemPublic] = []
    @State private var purchases: [VaultPurchasePublic] = []
    @State private var history: [VaultPurchasePublic] = []
    @State private var wallets: [String: WalletLinkPublic]?
    @State private var payments: PaymentsSettingsPublic?
    @State private var methods: [PaymentMethodPublic] = []
    @State private var onePassword: OnePasswordStatusPublic?
    @State private var opItems: [OnePasswordPickerItem]?
    @State private var opQuery = ""
    @State private var revealed: String?
    @State private var error: String?
    @State private var busy = false
    @State private var cardName = ""
    @State private var holder = ""
    @State private var pan = ""
    @State private var cvv = ""
    @State private var expMonth = ""
    @State private var expYear = ""
    @State private var draftingLimits: [String: BotLimitDraft] = [:]

    private struct BotLimitDraft {
        var perPurchase: String
        var perMonth: String
        var merchants: String
    }

    private var bots: [Bot] {
        session.state.bots.filter { $0.hidden != true }
    }

    private var loginItems: [VaultItemPublic] {
        items.filter { ["login", "apiKey", "note"].contains($0.kind) }
    }

    private var cardItems: [VaultItemPublic] {
        items.filter { $0.kind == "card" }
    }

    private var contactItems: [VaultItemPublic] {
        items.filter { ["address", "contact"].contains($0.kind) }
    }

    private func count(for filter: Filter) -> Int {
        switch filter {
        case .all: return items.count
        case .logins: return loginItems.count
        case .payments: return cardItems.count + purchases.count
        case .contacts: return contactItems.count
        }
    }

    var body: some View {
        SettingsPage(title: "Vault") {
            filterPills
            if let error {
                Text(verbatim: error).font(.footnote).foregroundStyle(.red).padding(.horizontal, 24)
            }
            switch filter {
            case .all:
                pendingSection
                walletsSection
                onePasswordSection
                itemsSection(loginItems + cardItems + contactItems)
                newCardSection
            case .logins:
                onePasswordSection
                itemsSection(loginItems)
            case .payments:
                paymentsMethodsSection
                defaultMethodSection
                botAllowancesSection
                pendingSection
                historySection
                newCardSection
            case .contacts:
                itemsSection(contactItems)
            }
            if let revealed {
                Text(verbatim: revealed).font(.footnote).padding(.horizontal, 24).textSelection(.enabled)
            }
            if filter == .all || filter == .payments {
                SettingsFooter(text: "The bot never sees a card number. Face ID shows it to you.")
            }
        }
        .task { await load() }
    }

    // MARK: Filter pills

    private var filterPills: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Filter.allCases) { tab in
                    let selected = filter == tab
                    Button {
                        filter = tab
                    } label: {
                        Text(verbatim: "\(tab.title) \(count(for: tab))")
                            .font(.system(size: 13, weight: selected ? .semibold : .regular))
                            .foregroundStyle(selected ? Theme.textPrimary : Theme.textSecondary)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(selected ? Theme.card : Color.clear)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .strokeBorder(Theme.hairline, lineWidth: selected ? 1 : 0)
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("vault-filter-\(tab.rawValue)")
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            .padding(.horizontal, SettingsMetrics.cardMargin)
            .padding(.bottom, 8)
        }
    }

    // MARK: Payments

    @ViewBuilder
    private var paymentsMethodsSection: some View {
        SettingsSectionLabel(text: "Payment methods")
        SettingsCard {
            SettingsFooter(text: "Cards you saved and wallets you already have. The bot never sees a full card number.")
            if methods.isEmpty && VaultWallet.rows(wallets).isEmpty {
                SettingsRow(title: "No payment method yet", accessory: .none, identifier: "vault-payments-methods-empty") {}
            }
            ForEach(Array(methods.filter { $0.type == "card" }.enumerated()), id: \.element.id) { index, method in
                if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                SettingsRow(
                    title: LocalizedStringKey(method.label),
                    subtitle: method.detail,
                    accessory: method.isDefault ? .check : .none,
                    identifier: "vault-method-\(method.id)"
                ) {}
            }
            ForEach(VaultWallet.rows(wallets), id: \.id) { entry in
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(
                    title: LocalizedStringKey(VaultWallet.label(entry.id)),
                    subtitle: entry.row.chosen
                        ? (entry.row.ready
                            ? "Live: signed in on your computer. Sagax asks it for a one-time card after you allow a purchase."
                            : "Chosen. Not live yet: \(entry.row.missing). Nothing is charged.")
                        : "Not connected. Turn this on to use the account you already have. Nothing is charged.",
                    accessory: .toggle(Binding(
                        get: { wallets?[entry.id]?.chosen == true },
                        set: { value in Task { await chooseWallet(entry.id, value) } }
                    )),
                    identifier: "vault-wallet-\(entry.id)"
                )
            }
        }
        SettingsFooter(text: "PayPal and other account providers without a vault link stay card-only: save the card you use with them.")
    }

    @ViewBuilder
    private var defaultMethodSection: some View {
        SettingsSectionLabel(text: "Bots use first")
        SettingsCard {
            SettingsRow(
                title: "No default",
                accessory: payments?.defaultMethod == nil ? .check : .none,
                identifier: "vault-default-none"
            ) {
                Task { await patchDefault(nil) }
            }
            ForEach(methods, id: \.id) { method in
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(
                    title: LocalizedStringKey(method.label),
                    subtitle: method.detail,
                    accessory: method.isDefault ? .check : .none,
                    identifier: "vault-default-\(method.id)"
                ) {
                    Task { await pickDefault(method) }
                }
            }
        }
        SettingsFooter(text: "When a bot does not name a method, it uses this one. A purchase asks you, unless the bot is at Full access or you always allowed that site.")
    }

    @ViewBuilder
    private var botAllowancesSection: some View {
        SettingsSectionLabel(text: "Which bots may pay")
        SettingsCard {
            SettingsFooter(text: "On by default for your bots. Set a per-purchase or monthly limit, or an optional list of merchant sites.")
            if bots.isEmpty {
                SettingsRow(title: "No bots yet", accessory: .none, identifier: "vault-payments-bots-empty") {}
            }
            ForEach(Array(bots.enumerated()), id: \.element.id) { index, bot in
                if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                let allowance = payments?.allowance(for: bot.id) ?? BotPaymentAllowancePublic()
                let draft = draftingLimits[bot.id] ?? BotLimitDraft(
                    perPurchase: allowance.perPurchaseLimit ?? "",
                    perMonth: allowance.perMonthLimit ?? "",
                    merchants: (allowance.merchants ?? []).joined(separator: ", ")
                )
                VStack(alignment: .leading, spacing: 8) {
                    SettingsRow(
                        title: LocalizedStringKey(bot.name),
                        subtitle: String(localized: "May pay"),
                        accessory: .toggle(Binding(
                            get: { allowance.mayPay },
                            set: { value in Task { await setMayPay(bot.id, value) } }
                        )),
                        identifier: "vault-bot-pay-\(bot.id)"
                    )
                    if allowance.mayPay {
                        VaultField(
                            text: limitBinding(bot.id, draft, \.perPurchase),
                            prompt: String(localized: "Per purchase"),
                            identifier: "vault-bot-purchase-\(bot.id)"
                        )
                        VaultField(
                            text: limitBinding(bot.id, draft, \.perMonth),
                            prompt: String(localized: "Per month"),
                            identifier: "vault-bot-month-\(bot.id)"
                        )
                        VaultField(
                            text: limitBinding(bot.id, draft, \.merchants),
                            prompt: String(localized: "Merchants"),
                            identifier: "vault-bot-merchants-\(bot.id)"
                        )
                        SettingsRow(title: "Save limits", accessory: .none, style: .action, identifier: "vault-bot-save-\(bot.id)") {
                            Task { await saveLimits(bot.id) }
                        }
                    }
                }
            }
        }
        SettingsFooter(text: "Optional hostnames, comma-separated. Empty means any site.")
    }

    @ViewBuilder
    private var pendingSection: some View {
        if !purchases.isEmpty {
            SettingsSectionLabel(text: "Waiting for you")
            SettingsCard {
                ForEach(Array(purchases.enumerated()), id: \.element.id) { index, purchase in
                    if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                    VStack(alignment: .leading, spacing: 8) {
                        Text(purchase.title).font(.body)
                        Text(purchase.line).font(.footnote).foregroundStyle(.secondary)
                        HStack {
                            Button("Cancel") { Task { await answer(purchase, "deny") } }
                            Button("Pay") { Task { await answer(purchase, "once") } }
                        }
                        .buttonStyle(.bordered)
                    }
                    .padding(.horizontal, SettingsMetrics.rowInset)
                    .padding(.vertical, 10)
                    .accessibilityIdentifier("vault-pending-\(purchase.id)")
                }
            }
        }
    }

    @ViewBuilder
    private var historySection: some View {
        SettingsSectionLabel(text: "History")
        SettingsCard {
            if history.isEmpty {
                SettingsFooter(text: "Purchases you allow appear here after the shop confirms the order.")
            }
            ForEach(Array(history.enumerated()), id: \.element.id) { index, row in
                if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                SettingsRow(
                    title: LocalizedStringKey(historyTitle(row)),
                    subtitle: historySubtitle(row),
                    accessory: .none,
                    identifier: "vault-history-\(row.id)"
                ) {}
            }
        }
    }

    // MARK: Shared sections

    @ViewBuilder
    private var walletsSection: some View {
        if !VaultWallet.rows(wallets).isEmpty {
            SettingsSectionLabel(text: "One-time card")
            SettingsCard {
                SettingsFooter(text: "Shop Pay and Link are wallets you already have. Sagax asks that wallet for a one-time card only after you allow the purchase, through the wallet's own command line tool signed in on your computer. The site does not receive a saved card number, and the bot never sees it.")
                ForEach(VaultWallet.rows(wallets), id: \.id) { entry in
                    SettingsRow(
                        title: LocalizedStringKey(VaultWallet.label(entry.id)),
                        subtitle: entry.row.chosen
                            ? (entry.row.ready
                                ? "Live: signed in on your computer. Sagax asks it for a one-time card after you allow a purchase."
                                : "Chosen. Not live yet: \(entry.row.missing). Nothing is charged.")
                            : "Not connected. Turn this on to use the account you already have. Nothing is charged.",
                        accessory: .toggle(Binding(
                            get: { wallets?[entry.id]?.chosen == true },
                            set: { value in Task { await chooseWallet(entry.id, value) } }
                        )),
                        identifier: "vault-wallet-\(entry.id)"
                    )
                }
            }
        }
    }

    @ViewBuilder
    private var onePasswordSection: some View {
        if OnePasswordSettings.shown(onePassword), let status = onePassword {
            SettingsSectionLabel(text: "1Password")
            SettingsCard {
                Text(verbatim: OnePasswordSettings.subtitle(status))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, SettingsMetrics.rowInset)
                    .padding(.vertical, 8)
                if !status.available {
                    SettingsFooter(text: "To connect 1Password: install the app and the CLI, turn on Integrate with 1Password CLI, unlock 1Password, then check again.")
                    SettingsRow(title: "Check again", accessory: .none, identifier: "vault-onepassword-recheck") {
                        Task { await recheckOnePassword() }
                    }
                } else {
                    SettingsFooter(text: "A bot's sign-in request shows your 1Password items for that site. Allow once covers that one request. Read only: Sagax never changes your 1Password items.")
                    if opItems == nil {
                        SettingsRow(title: "Choose from 1Password", accessory: .none, identifier: "vault-onepassword-pick") {
                            Task { await loadOnePassword() }
                        }
                    } else {
                        VaultField(text: $opQuery, prompt: "Search 1Password", identifier: "vault-onepassword-search")
                        ForEach(filteredOnePassword) { item in
                            SettingsRow(
                                title: LocalizedStringKey(item.title),
                                subtitle: item.domains.isEmpty ? item.vaultName : "\(item.vaultName) · \(item.domains.joined(separator: ", "))",
                                accessory: .none,
                                identifier: "vault-onepassword-add"
                            ) {
                                Task { await importOnePassword(item) }
                            }
                        }
                        if filteredOnePassword.isEmpty {
                            SettingsFooter(text: "No matching item.")
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func itemsSection(_ shown: [VaultItemPublic]) -> some View {
        SettingsSectionLabel(text: "Vault")
        SettingsCard {
            if shown.isEmpty {
                SettingsRow(title: "Nothing saved yet", accessory: .none, identifier: "vault-empty") {}
            }
            ForEach(Array(shown.enumerated()), id: \.element.id) { index, item in
                if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                SettingsRow(title: LocalizedStringKey(item.name), subtitle: item.subtitle, accessory: .none, identifier: "vault-item") {}
                if let field = item.revealField {
                    SettingsRow(title: field == "password" ? "Show password" : "Show key", accessory: .none, identifier: "vault-reveal-secret") {
                        Task { await reveal(item, field: field) }
                    }
                }
                if item.card != nil {
                    SettingsRow(title: "Show number", accessory: .none, identifier: "vault-reveal") {
                        Task { await reveal(item) }
                    }
                }
                SettingsRow(title: "Remove", accessory: .none, style: .destructive, identifier: "vault-remove") {
                    Task { await remove(item) }
                }
            }
        }
    }

    @ViewBuilder
    private var newCardSection: some View {
        SettingsSectionLabel(text: "New card")
        SettingsCard {
            CardPhotoScanner { read in
                if let number = read.pan { pan = number }
                if let month = read.expMonth { expMonth = String(month) }
                if let year = read.expYear { expYear = String(year) }
                if let name = read.holder { holder = name }
            }
            VaultField(text: $cardName, prompt: "Name", identifier: "vault-card-name")
            VaultField(text: $holder, prompt: "Name on the card", identifier: "vault-card-holder")
            VaultField(text: $pan, prompt: "Card number", identifier: "vault-card-number", secure: true)
            VaultField(text: $cvv, prompt: "Security code", identifier: "vault-card-cvv", secure: true)
            VaultField(text: $expMonth, prompt: "Month", identifier: "vault-card-month")
            VaultField(text: $expYear, prompt: "Year", identifier: "vault-card-year")
            SettingsRow(title: "Add card", accessory: .none, identifier: "vault-add") { Task { await addCard() } }
        }
    }

    // MARK: Helpers

    private func limitBinding(_ botId: String, _ seed: BotLimitDraft, _ keyPath: WritableKeyPath<BotLimitDraft, String>) -> Binding<String> {
        Binding(
            get: { draftingLimits[botId]?[keyPath: keyPath] ?? seed[keyPath: keyPath] },
            set: { value in
                var next = draftingLimits[botId] ?? seed
                next[keyPath: keyPath] = value
                draftingLimits[botId] = next
            }
        )
    }

    private func historyTitle(_ row: VaultPurchasePublic) -> String {
        if let amount = row.amount, let currency = row.currency, !amount.isEmpty {
            return "\(amount) \(currency) · \(row.merchant)"
        }
        return row.title
    }

    private func historySubtitle(_ row: VaultPurchasePublic) -> String {
        var parts: [String] = []
        if let status = row.status, !status.isEmpty { parts.append(status) }
        if let name = row.cardName, !name.isEmpty {
            if let last4 = row.cardLast4, !last4.isEmpty {
                parts.append("\(name) ···· \(last4)")
            } else {
                parts.append(name)
            }
        } else if let wallet = row.wallet {
            parts.append(VaultWallet.label(wallet))
        }
        if let orderRef = row.orderRef, !orderRef.isEmpty {
            parts.append(String(localized: "Order \(orderRef)"))
        }
        if parts.isEmpty { return row.line }
        return parts.joined(separator: " · ")
    }

    private func pickDefault(_ method: PaymentMethodPublic) async {
        if method.type == "card" {
            let cardId = method.id.hasPrefix("card:") ? String(method.id.dropFirst(5)) : method.id
            await patchDefault(.card(cardId))
        } else if method.type == "wallet", let wallet = method.wallet {
            await patchDefault(.wallet(wallet))
        }
    }

    private func patchDefault(_ method: PaymentMethodRefPublic?) async {
        guard let client = session.settingsClient else { return }
        do {
            let response = try await client.patchPayments(PaymentsSettingsPatch(defaultMethod: .some(method)))
            payments = response.payments
            methods = response.methods
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func setMayPay(_ botId: String, _ enabled: Bool) async {
        guard let client = session.settingsClient else { return }
        do {
            let response = try await client.patchPayments(
                PaymentsSettingsPatch(bots: [botId: BotPaymentAllowancePublic(enabled: enabled)])
            )
            payments = response.payments
            methods = response.methods
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func saveLimits(_ botId: String) async {
        guard let client = session.settingsClient else { return }
        let draft = draftingLimits[botId] ?? BotLimitDraft(perPurchase: "", perMonth: "", merchants: "")
        let merchants = draft.merchants
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty }
        let purchase = draft.perPurchase.trimmingCharacters(in: .whitespacesAndNewlines)
        let month = draft.perMonth.trimmingCharacters(in: .whitespacesAndNewlines)
        let allowance = BotPaymentAllowancePublic(
            perPurchaseLimit: purchase.isEmpty ? nil : purchase,
            perMonthLimit: month.isEmpty ? nil : month,
            merchants: merchants.isEmpty ? nil : merchants
        )
        do {
            let response = try await client.patchPayments(PaymentsSettingsPatch(bots: [botId: allowance]))
            payments = response.payments
            methods = response.methods
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func load() async {
        guard let client = session.settingsClient else { return }
        do {
            let list = try await client.vaultItems()
            items = list.items
            purchases = list.purchases
            history = list.history
            wallets = list.wallets
            payments = list.payments
            methods = list.methods
            onePassword = list.onePassword
            for bot in bots {
                let allowance = list.payments?.allowance(for: bot.id) ?? BotPaymentAllowancePublic()
                draftingLimits[bot.id] = BotLimitDraft(
                    perPurchase: allowance.perPurchaseLimit ?? "",
                    perMonth: allowance.perMonthLimit ?? "",
                    merchants: (allowance.merchants ?? []).joined(separator: ", ")
                )
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func reveal(_ item: VaultItemPublic, field: String = "pan") async {
        guard !busy, let client = session.settingsClient else { return }
        guard await VaultRevealGate.confirm(reason: field == "pan" ? "Show the card number saved in Sagax" : "Show the secret saved in Sagax") else { return }
        busy = true
        defer { busy = false }
        do {
            revealed = try await client.revealVaultItem(id: item.id, field: field).value
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func addCard() async {
        guard let client = session.settingsClient else { return }
        guard let month = Int(expMonth), let year = Int(expYear) else { error = "The expiry is a month and a year."; return }
        do {
            try await client.addVaultCard(name: cardName, holder: holder, pan: pan, cvv: cvv, expMonth: month, expYear: year)
            cardName = ""; holder = ""; pan = ""; cvv = ""; expMonth = ""; expYear = ""
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func remove(_ item: VaultItemPublic) async {
        guard let client = session.settingsClient else { return }
        do {
            try await client.deleteVaultItem(id: item.id)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private var filteredOnePassword: [OnePasswordPickerItem] {
        let query = opQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return (opItems ?? []).filter { item in
            query.isEmpty || item.title.lowercased().contains(query) || item.domains.contains { $0.lowercased().contains(query) }
        }.prefix(50).map { $0 }
    }

    private func chooseWallet(_ id: String, _ chosen: Bool) async {
        guard let client = session.settingsClient else { return }
        do {
            wallets = try await client.chooseWallet(id, chosen: chosen)
            await load()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func recheckOnePassword() async {
        guard let client = session.settingsClient else { return }
        _ = try? await client.onePasswordItems()
        await load()
    }

    private func loadOnePassword() async {
        guard let client = session.settingsClient else { return }
        do {
            opItems = try await client.onePasswordItems()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func importOnePassword(_ item: OnePasswordPickerItem) async {
        guard !item.domains.isEmpty, let client = session.settingsClient else { return }
        do {
            try await client.importOnePassword(vaultId: item.vaultId, itemId: item.id)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func answer(_ purchase: VaultPurchasePublic, _ decision: String) async {
        guard let client = session.settingsClient else { return }
        do {
            try await client.answerPurchase(id: purchase.id, decision: decision)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct VaultField: View {
    @Binding var text: String
    var prompt: String
    var identifier: String
    var secure = false

    var body: some View {
        Group {
            if secure {
                SecureField(prompt, text: $text)
            } else {
                TextField(prompt, text: $text)
            }
        }
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .padding(.horizontal, SettingsMetrics.rowInset)
        .padding(.vertical, 8)
        .accessibilityIdentifier(identifier)
    }
}

/// Settings > Security keys: the same list as the desktop. Adding a key
/// still uses the server's ceremony. Removing one asks the key when the
/// server says so.
struct SecurityKeysSettingsView: View {
    @EnvironmentObject private var session: Session
    @State private var keys: [SecurityKeyPublic] = []
    @State private var error: String?

    var body: some View {
        SettingsPage(title: "Security keys") {
            if let error {
                Text(verbatim: error).font(.footnote).foregroundStyle(.red).padding(.horizontal, 24)
            }
            SettingsCard {
                if keys.isEmpty {
                    SettingsRow(title: "No security key yet", accessory: .none, identifier: "security-keys-empty") {}
                }
                ForEach(Array(keys.enumerated()), id: \.element.id) { index, key in
                    if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                    SettingsRow(title: LocalizedStringKey(key.name), accessory: .none, identifier: "security-key") {}
                    SettingsRow(title: "Remove", accessory: .none, style: .destructive, identifier: "security-key-remove") {
                        Task { await remove(key) }
                    }
                }
            }
            SettingsCard {
                SettingsRow(title: "Add a key", accessory: .none, identifier: "security-key-add") { Task { await add() } }
            }
            SettingsFooter(text: "A key confirms a sensitive approval, including a payment when you ask for one.")
        }
        .task { await load() }
    }

    private func load() async {
        guard let client = session.settingsClient else { return }
        do {
            keys = try await client.securityKeys().keys
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func add() async {
        guard let client = session.settingsClient else { return }
        do {
            let start = try await client.beginSecurityKey(name: "iPhone")
            guard let page = client.stepUpPageURL(start) else {
                error = "A security key needs this server on https."
                return
            }
            _ = try await SecurityKeyStepUp.shared.open(page: page, ceremonyId: start.ceremonyId)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func remove(_ key: SecurityKeyPublic) async {
        guard let client = session.settingsClient else { return }
        do {
            try await client.deleteSecurityKey(id: key.id)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
