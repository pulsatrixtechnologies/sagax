// Import an agent from x.ai bot on iOS (desktop AgentImport.tsx,
// docs/import-agent.md): copy the export prompt, send it to your own bot on
// x.ai, paste its reply. The server makes the package and stages it; the
// preview says what will be created (inert: skills off, routines paused, no
// key or sign-in) and what was left out, in the person's language. Nothing is
// created before Import. Anyone who may create bots can do it. With a
// `marketplaceSlug` (Browse Bots > xAI Bot Marketplace) the server reads that
// bot's page instead of a pasted reply, and the same preview follows.
import CompanionCore
import SwiftUI
import UIKit

struct AgentImportSheet: View {
    @EnvironmentObject private var session: Session
    let close: () -> Void
    let imported: (Bot?) -> Void
    /// The parity harness opens it with a reply already pasted (DEBUG).
    var initialReply = ""
    /// A bot of the xAI Bot Marketplace to stage at once.
    var marketplaceSlug: String?

    @State private var reply = ""
    @State private var prompt: String?
    @State private var copied = false
    @State private var reading = false
    @State private var staged: AgentImportStaged?
    @State private var name = ""
    @State private var importing = false
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            Form {
                if let staged {
                    preview(staged)
                } else if marketplaceSlug != nil {
                    Section {
                        if reading {
                            HStack { Text("Reading the xAI Bot Marketplace…").foregroundStyle(Theme.textSecondary); Spacer(); ProgressView() }
                        } else {
                            Button("Try again") { Task { await stage() } }
                        }
                    }
                } else {
                    Section {
                        Text("Bring a bot you use in Grok Bot into Sagax. It arrives inert: skills off, routines paused, and no key, token or sign-in comes over.")
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                    }
                    Section {
                        Button { Task { await copyPrompt() } } label: {
                            Label(copied ? "Copied" : "Copy export prompt", systemImage: copied ? "checkmark" : "doc.on.doc")
                        }
                        .accessibilityIdentifier("agent-import-copy-prompt")
                    } header: {
                        Text("1. Send the export prompt to your Grok Bot")
                    }
                    Section {
                        TextEditor(text: $reply)
                            .font(.system(.footnote, design: .monospaced))
                            .frame(minHeight: 160)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .accessibilityIdentifier("agent-import-reply")
                        Button { Task { await stage() } } label: {
                            HStack { Text("Preview"); if reading { Spacer(); ProgressView() } }
                        }
                        .disabled(reading || reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("agent-import-preview")
                    } header: {
                        Text("2. Paste its reply")
                    }
                }
                if let failure {
                    Section { Text(verbatim: failure).foregroundStyle(.red) }
                }
            }
            .navigationTitle(marketplaceSlug == nil ? String(localized: "Import an agent") : XaiMarketplaceRules.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { Task { await discard(); close() } } }
                if staged != nil {
                    ToolbarItem(placement: .confirmationAction) {
                        if importing { ProgressView() } else {
                            Button("Import") { Task { await runImport() } }
                                .accessibilityIdentifier("agent-import-confirm")
                        }
                    }
                }
            }
            .interactiveDismissDisabled(staged != nil)
            .task {
                if marketplaceSlug != nil, staged == nil {
                    await stage()
                    return
                }
                if reply.isEmpty, !initialReply.isEmpty {
                    reply = initialReply
                    await stage()
                }
            }
        }
        .accessibilityIdentifier("agent-import-sheet")
    }

    @ViewBuilder private func preview(_ staged: AgentImportStaged) -> some View {
        Section {
            Text(verbatim: staged.preview.name).font(.headline)
            if marketplaceSlug == nil {
            Text("From Grok Bot").font(.footnote).foregroundStyle(Theme.textSecondary)
            } else {
                Text("From the xAI Bot Marketplace").font(.footnote).foregroundStyle(Theme.textSecondary)
            }
            TextField("Name", text: $name)
                .accessibilityIdentifier("agent-import-name")
        }
        Section {
            Text("1 bot")
            if let skills = staged.preview.includesSkills, skills > 0 {
                Text("\(skills) skill(s), off until you turn them on")
            }
            if let routines = staged.preview.includesRoutines, routines > 0 {
                Text("\(routines) routine(s), paused until you start them")
            }
        } header: {
            Text("Will be created")
        } footer: {
            Text("Nothing runs until you say so: no routine starts and no app is signed in.")
        }
        if !staged.leftOut.isEmpty {
            Section("Left out (set these up by hand)") {
                ForEach(Array(staged.leftOut.enumerated()), id: \.offset) { _, item in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(String(localized: "\(Self.text(item.nameKey, item.name, item.params)): \(Self.text(item.reasonKey, item.reason, item.params))", comment: "A left-out line: what, then why"))
                            .font(.footnote)
                        if let original = item.original, !original.isEmpty {
                            Text(verbatim: original)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                }
            }
        }
    }

    /// A left-out line in the person's language: the catalog keys the server
    /// names map to the English templates below (Localizable.xcstrings
    /// translates them); a key this build does not know keeps the server's English.
    static func text(_ key: String?, _ english: String, _ params: [String: AgentImportParam]?) -> String {
        guard let key, let template = templates[key] else { return english }
        return AgentImportRules.fill(String(localized: template), params)
    }

    static let templates: [String: String.LocalizationValue] = [
        "leftOut.name.instructions": "Standing instructions",
        "leftOut.name.skill": "Skill “{name}”",
        "leftOut.name.routine": "Routine “{name}”",
        "leftOut.name.app": "App “{name}”",
        "leftOut.name.memories": "Memories",
        "leftOut.name.secrets": "Keys and passwords",
        "leftOut.reason.eventRoutine": "it starts on an event, not a clock",
        "leftOut.reason.unreadableSchedule": "its schedule could not be read",
        "leftOut.reason.noSchedule": "the export gave no schedule for it",
        "leftOut.reason.instructionsCut": "they were longer than {bytes} bytes, so the end was cut. Check them after adding the bot",
        "leftOut.reason.maxSkills": "a bot holds at most {max} skills",
        "leftOut.reason.unreadableSkill": "its text could not be read as a skill",
        "leftOut.reason.noSkillText": "the export had no text for it",
        "leftOut.reason.maxRoutines": "a package holds at most {max} routines",
        "leftOut.reason.noPrompt": "the export had no prompt for it",
        "leftOut.reason.maxApps": "a package lists at most {max} apps",
        "leftOut.reason.memoriesTooLarge": "they were larger than 256 KB",
        "leftOut.reason.secretsReplaced": "text that looked like a key or password was replaced in {parts}",
    ]

    private func copyPrompt() async {
        failure = nil
        do {
            if prompt == nil { prompt = try await session.profileClient?.agentImportPrompt() }
            guard let prompt else { return }
            UIPasteboard.general.string = prompt
            copied = true
        } catch { failure = error.localizedDescription }
    }

    private func stage() async {
        guard let client = session.profileClient else { return }
        failure = nil
        reading = true
        defer { reading = false }
        do {
            let result = if let marketplaceSlug {
                try await client.stageXaiMarketplaceImport(slug: marketplaceSlug)
            } else {
                try await client.stageAgentImport(text: reply)
            }
            staged = result
            name = result.preview.importName
        } catch { failure = error.localizedDescription }
    }

    private func runImport() async {
        guard let client = session.profileClient, let staged else { return }
        importing = true
        defer { importing = false }
        do {
            let result = try await client.importBotZip(
                id: staged.id, name: BotZipRules.importName(name, preview: staged.preview), conversations: false, sharing: false
            )
            self.staged = nil
            await session.refresh()
            imported(session.state.bot(result.botId))
        } catch { failure = error.localizedDescription }
    }

    private func discard() async {
        guard let staged, let client = session.profileClient else { return }
        try? await client.discardBotZip(id: staged.id)
    }
}
