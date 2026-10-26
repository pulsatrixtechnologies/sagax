// Settings > Approval rules, at the end: the phone tools this iPhone offers
// to the person's own bots (one switch each, all on until turned off; a
// tool that is off is never offered to a bot), and the "Toujours permettre"
// given on this phone's cards, each removable. Every request still needs
// the phone: a switch that is on only lets a bot ask.
import CompanionCore
import SwiftUI

struct PhoneToolsSettingsSections: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @State private var disabled = PhoneToolCenter.disabled
    @State private var grants: [PhoneToolGrant]?

    var body: some View {
        Section {
            ForEach(PhoneTool.allCases) { tool in
                Toggle(isOn: Binding(
                    get: { !disabled.contains(tool.rawValue) },
                    set: { on in
                        PhoneToolCenter.setEnabled(tool, on)
                        disabled = PhoneToolCenter.disabled
                        Task { await PhoneToolCenter.shared.register() }
                    }
                )) {
                    Label(PhoneToolWords.name(tool), systemImage: PhoneToolWords.symbol(tool))
                }
                .accessibilityIdentifier("phone-tool-\(tool.rawValue)")
            }
        } header: {
            Text("Phone tools")
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                if !session.phoneCredentialTransportIsProtected {
                    Text("Off on this connection: phone tools need a secure connection (HTTPS or Tailscale). On plain local Wi-Fi your answers would cross the network in clear.")
                        .foregroundStyle(Theme.danger)
                }
                Text("Your own bots may ask this iPhone for these. You approve each request here, with Sagax open; nothing runs in the background.")
            }
        }
        Section {
            if grants == nil {
                ProgressView().tint(Theme.textSecondary)
            } else if grants?.isEmpty == true {
                Text("Nothing is always allowed on this phone.")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
            }
            ForEach(grants ?? []) { grant in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: grant.botName ?? String(localized: "Deleted bot"))
                        Text(verbatim: grantLine(grant))
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                    Button("Remove", role: .destructive) { Task { await revoke(grant) } }
                        .buttonStyle(.borderless)
                }
            }
        } header: {
            Text("Always allowed on this phone")
        }
        .task { await load() }
    }

    private func grantLine(_ grant: PhoneToolGrant) -> String {
        let name = PhoneTool(rawValue: grant.tool).map(PhoneToolWords.name) ?? grant.tool
        return grant.access == "write" ? String(localized: "\(name): add") : String(localized: "\(name): read")
    }

    private func load() async {
        await session.perform(quietly: true) { client in grants = try await client.phoneToolGrants() }
        if grants == nil { grants = [] }
    }

    private func revoke(_ grant: PhoneToolGrant) async {
        await session.perform { client in try await client.revokePhoneToolGrant(botId: grant.botId, key: grant.key) }
        await load()
    }
}
