import CompanionCore
import SwiftUI

/// Settings > Vault: the person's cards, addresses, contacts and logins.
/// A number is shown only after Face ID. Purchases use the same three
/// answers as an approval card.
struct VaultSettingsView: View {
    @EnvironmentObject private var session: Session
    @State private var items: [VaultItemPublic] = []
    @State private var purchases: [VaultPurchasePublic] = []
    @State private var revealed: String?
    @State private var error: String?
    @State private var busy = false
    @State private var cardName = ""
    @State private var holder = ""
    @State private var pan = ""
    @State private var cvv = ""
    @State private var expMonth = ""
    @State private var expYear = ""

    var body: some View {
        SettingsPage(title: "Vault") {
            if let error {
                Text(verbatim: error).font(.footnote).foregroundStyle(.red).padding(.horizontal, 24)
            }
            if !purchases.isEmpty {
                SettingsSectionLabel(text: "Purchases")
                SettingsCard {
                    ForEach(Array(purchases.enumerated()), id: \.element.id) { index, purchase in
                        if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                        VStack(alignment: .leading, spacing: 8) {
                            Text(purchase.title).font(.body)
                            Text(purchase.line).font(.footnote).foregroundStyle(.secondary)
                            HStack {
                                Button("Deny") { Task { await answer(purchase, "deny") } }
                                Button("Allow once") { Task { await answer(purchase, "once") } }
                            }
                            .buttonStyle(.bordered)
                        }
                        .padding(.horizontal, SettingsMetrics.rowInset)
                        .padding(.vertical, 10)
                    }
                }
            }
            SettingsSectionLabel(text: "Vault")
            SettingsCard {
                if items.isEmpty {
                    SettingsRow(title: "Nothing saved yet", accessory: .none, identifier: "vault-empty") {}
                }
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                    SettingsRow(title: LocalizedStringKey(item.name), subtitle: item.subtitle, accessory: .none, identifier: "vault-item") {}
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
            SettingsSectionLabel(text: "New card")
            SettingsCard {
                // read on the phone from photos of the card (parité R10)
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
            if let revealed {
                Text(verbatim: revealed).font(.footnote).padding(.horizontal, 24).textSelection(.enabled)
            }
            SettingsFooter(text: "The bot never sees a card number. Face ID shows it to you.")
        }
        .task { await load() }
    }

    private func load() async {
        guard let client = session.settingsClient else { return }
        do {
            let list = try await client.vaultItems()
            items = list.items
            purchases = list.purchases
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func reveal(_ item: VaultItemPublic) async {
        guard !busy, let client = session.settingsClient else { return }
        guard await VaultRevealGate.confirm(reason: "Show the card number saved in Sagax") else { return }
        busy = true
        defer { busy = false }
        do {
            revealed = try await client.revealVaultItem(id: item.id, field: "pan").value
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
