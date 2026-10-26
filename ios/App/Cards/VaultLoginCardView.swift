// 2026-10-21 (parité R10, lignes 82 et AP9): a bot's sign-in request
// (secret target "vaultLogin") answered on the phone, as on the computer
// (src/components/VaultRequestCard.tsx): the person's saved logins for the
// site, and their 1Password items for it when 1Password is on their
// computer. Refuse, Always allow (one tap) or Allow once (JC #875). The phone
// never sees a password: it sends a choice; the value is read on the
// computer only when the bot fills it (1Password may ask there first).
import SwiftUI
import CompanionCore

struct VaultLoginCardView: View {
    let chat: Chat
    let message: Message
    let secret: SecretRequestCardData
    @EnvironmentObject private var session: Session
    @State private var saved: [VaultItemPublic]?
    @State private var onePassword: [VaultCardOnePasswordItem] = []
    @State private var choice: String?
    @State private var busy = false
    @State private var error: String?

    private var request: VaultRequestPublic { secret.vault ?? VaultRequestPublic() }
    private var tint: Color { MausPalette.color(message.from?.color ?? chat.color) }
    private var requester: String { message.from?.name ?? chat.name }
    private var botID: String? {
        switch chat {
        case let .bot(bot): return bot.id
        case .room: return message.from?.botId
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 11) {
                Image(systemName: "key.fill")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Theme.readable(tint))
                    .frame(width: 38, height: 38)
                    .background(tint.opacity(0.13), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text("Sign in to \(request.site)")
                        .font(.system(size: 16, weight: .semibold))
                    Text("Requested by \(requester)")
                        .font(.system(size: 12.5))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 0)
            }

            if secret.superseded == true {
                Label("Replaced by a newer request", systemImage: "xmark.circle")
                    .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
            } else if request.signedInSelf == true {
                Label("You signed in to \(request.site) yourself", systemImage: "checkmark.circle")
                    .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
            } else if secret.dismissed == true {
                Label("Not shared", systemImage: "xmark.circle")
                    .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
            } else if secret.provided == true {
                settledLine
            } else {
                pending
            }

            if let error {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 12.5))
                    .foregroundStyle(Theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Theme.inset))
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(secret.isPending ? tint.opacity(0.65) : Color.clear, lineWidth: 1.25)
        }
        .task(id: message.id) { await load() }
        .accessibilityIdentifier("vault-login-card-\(message.id)")
    }

    private var settledLine: some View {
        let name = request.itemName ?? request.site
        let how: LocalizedStringKey = request.mode == "always" ? "always for \(requester)" : "this time"
        return HStack(spacing: 4) {
            Image(systemName: "checkmark.shield.fill").foregroundStyle(Theme.success)
            Text("Login \"\(name)\" allowed")
            if request.onePassword == true { Text("· 1Password") }
            Text("·")
            Text(how)
        }
        .font(.system(size: 13))
        .foregroundStyle(Theme.textSecondary)
    }

    @ViewBuilder private var pending: some View {
        Text("\(requester) can type it into that site's page but never read it.")
            .font(.system(size: 14))
            .foregroundStyle(Theme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
        if saved == nil {
            HStack(spacing: 8) { ProgressView(); Text("Looking in your vault…") }
                .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
        } else {
            let savedRows = saved ?? []
            let names = Set(savedRows.map { $0.name.lowercased() })
            let fromOnePassword = onePassword.filter { !names.contains($0.title.lowercased()) }
            if savedRows.isEmpty && fromOnePassword.isEmpty {
                Text("No saved login for this site. Add one on your computer, or sign in there yourself.")
                    .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(savedRows) { item in
                choiceRow(id: item.id, title: item.name, detail: item.domains.joined(separator: ", "))
            }
            if !fromOnePassword.isEmpty {
                Text("In 1Password")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                ForEach(fromOnePassword) { item in
                    choiceRow(id: item.id, title: item.title, detail: item.vaultName)
                }
            }
            buttons
            if let choice, choice.hasPrefix("op:") {
                Label("Read from 1Password only when the bot fills it, never added to chat. 1Password may ask you to approve.", systemImage: "lock.fill")
                    .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func choiceRow(id: String, title: String, detail: String) -> some View {
        Button {
            Haptics.selection()
            choice = id
        } label: {
            HStack(spacing: 10) {
                Image(systemName: choice == id ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(choice == id ? Theme.readable(tint) : Theme.textSecondary)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.system(size: 14.5, weight: .medium)).foregroundStyle(Theme.textPrimary)
                    if !detail.isEmpty { Text(detail).font(.system(size: 12)).foregroundStyle(Theme.textSecondary) }
                }
                Spacer(minLength: 0)
            }
            .frame(minHeight: 40)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(choice == id ? .isSelected : [])
    }

    /// Refuse, Always allow, Allow once: the card's three answers (#875).
    private var buttons: some View {
        HStack(spacing: 8) {
            Button("Deny") { act { client, bot in try await client.dismissVaultCard(botId: bot, messageId: message.id, threadId: chat.threadId) } }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("vault-refuse-\(message.id)")
            // a 1Password item: this request only (review of #954)
            if !choiceIsOnePassword {
                Button("Always allow") { grant(always: true) }
                    .buttonStyle(.bordered)
                    .disabled(choice == nil)
                    .accessibilityIdentifier("vault-always-\(message.id)")
            }
            Button("Allow once") { grant(always: false) }
                .buttonStyle(.borderedProminent)
                .tint(tint)
                .disabled(choice == nil)
                .accessibilityIdentifier("vault-once-\(message.id)")
        }
        .font(.system(size: 13.5, weight: .semibold))
        .disabled(busy)
    }

    private var choiceIsOnePassword: Bool {
        guard let choice else { return false }
        return choice.hasPrefix("op:") || (saved ?? []).first(where: { $0.id == choice })?.source == "1password"
    }

    private func grant(always: Bool) {
        guard let choice else { return }
        if let item = onePassword.first(where: { $0.id == choice }) {
            act { client, bot in try await client.grantVaultCardFromOnePassword(botId: bot, messageId: message.id, threadId: chat.threadId, item: item, always: always) }
        } else {
            act { client, bot in try await client.grantVaultCard(botId: bot, messageId: message.id, threadId: chat.threadId, itemId: choice, always: always) }
        }
    }

    private func act(_ work: @escaping (CompanionClient, String) async throws -> Void) {
        guard !busy, let client = session.settingsClient, let bot = botID else { return }
        busy = true
        error = nil
        Haptics.selection()
        Task {
            do { try await work(client, bot) } catch { self.error = error.localizedDescription }
            busy = false
        }
    }

    private func load() async {
        guard secret.isPending, let client = session.settingsClient else { saved = []; return }
        let list = try? await client.vaultItems()
        saved = VaultLoginMatching.matching(list?.items ?? [], request: request)
        if let bot = botID, let found = try? await client.vaultCardOnePassword(botId: bot, messageId: message.id, threadId: chat.threadId), found.available {
            onePassword = found.items
        }
        // only an item of the exact host is preselected (review of #954)
        choice = choice ?? VaultLoginMatching.preselected(saved: saved ?? [], onePassword: onePassword, request: request)
    }
}
