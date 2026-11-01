// Import / export / generate for portable Shape avatar definitions, inside
// the phone Character editor Shape section (parity with desktop
// ShapeAvatarPanel). Soft UX matching existing phone editor patterns.
import CompanionCore
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct ShapeAvatarEditorPanel: View {
    @Binding var draft: CharacterDraft
    @EnvironmentObject private var session: Session

    @State private var direction = ""
    @State private var error: String?
    @State private var notice: String?
    @State private var shareText: String?
    @State private var moodPreview: ShapeMood = .idle
    @State private var importing = false
    @State private var generating = false
    @State private var showShare = false

    private var currentDef: ShapeAvatarDef? {
        ShapeAvatarPresets.definition(for: draft.look) ?? ShapeAvatarPresets.byShape(draft.complete.shape)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Object shapes")
                .font(Theme.Font.labelMedium)
                .foregroundStyle(Theme.textPrimary)
                .accessibilityIdentifier("phone-shape-avatar-title")

            Text("Path silhouettes keep handles and appendages. Colour stays on the bot.")
                .font(Theme.Font.label)
                .foregroundStyle(Theme.textSecondary)

            objectPresets

            moodRow

            actionRow

            generateBlock

            if let shareText {
                TextField(String(localized: "Share"), text: .constant(shareText))
                    .textFieldStyle(.roundedBorder)
                    .font(Theme.Font.label)
                    .accessibilityIdentifier("phone-shape-avatar-share-url")
                    .onTapGesture { UIPasteboard.general.string = shareText }
            }

            if let error {
                Text(error)
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.danger)
                    .accessibilityIdentifier("phone-shape-avatar-error")
            } else if let notice {
                Text(notice)
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("phone-shape-avatar-notice")
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.cardRaised.opacity(0.55), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("phone-shape-avatar-panel")
        .fileImporter(
            isPresented: $importing,
            allowedContentTypes: [.json, .plainText],
            allowsMultipleSelection: false
        ) { result in
            guard case let .success(urls) = result, let url = urls.first else { return }
            guard url.startAccessingSecurityScopedResource() else { return }
            defer { url.stopAccessingSecurityScopedResource() }
            if let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8) {
                importText(text)
            }
        }
        .sheet(isPresented: $showShare) {
            if let shareText {
                ShapeAvatarActivitySheet(items: [shareText])
            }
        }
    }

    private var objectPresets: some View {
        let cols = [GridItem(.adaptive(minimum: 56), spacing: 8)]
        return LazyVGrid(columns: cols, spacing: 8) {
            ForEach(ShapeAvatarPresets.objectIds, id: \.self) { shape in
                let selected = draft.complete.shape == shape
                Button {
                    Haptics.selection()
                    apply(ShapeAvatarPresets.byShape(shape)!)
                } label: {
                    VStack(spacing: 4) {
                        ShapeMascotView(
                            shape: shape,
                            color: draft.color,
                            size: 36,
                            mood: moodPreview,
                            avatarDef: ShapeAvatarPresets.byShape(shape),
                            animated: false
                        )
                        .frame(width: 40, height: 40)
                        Text(verbatim: shape.rawValue)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(selected ? Theme.accentText : Theme.textSecondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .background(selected ? Theme.accent.opacity(0.15) : Theme.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(selected ? Theme.accent : Theme.hairline, lineWidth: selected ? 1.5 : 0.5)
                    )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("phone-shape-avatar-preset.\(shape.rawValue)")
            }
        }
    }

    private var moodRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Mood preview")
                .font(Theme.Font.labelMedium)
                .foregroundStyle(Theme.textPrimary)
            Picker(String(localized: "Mood"), selection: $moodPreview) {
                Text("Idle").tag(ShapeMood.idle)
                Text("Happy").tag(ShapeMood.happy)
                Text("Thinking").tag(ShapeMood.thinking)
                Text("Sleep").tag(ShapeMood.sleeping)
                Text("Working").tag(ShapeMood.working)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("phone-shape-avatar-mood")
        }
    }

    private var actionRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                actionButton("Export JSON", id: "export-json") { exportJSON() }
                actionButton("Export SVG", id: "export-svg") { exportSVG() }
                actionButton("Share", id: "share") { prepareShare() }
                actionButton("Import", id: "import") { importing = true }
                Button {
                    if let text = UIPasteboard.general.string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        importText(text)
                    } else {
                        error = String(localized: "Clipboard is empty.")
                        notice = nil
                    }
                } label: {
                    Text("Paste")
                        .font(Theme.Font.labelMedium)
                        .padding(.horizontal, 10)
                        .frame(height: 32)
                        .background(Theme.card, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("phone-shape-avatar-paste")
            }
        }
    }

    private var generateBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Generate")
                .font(Theme.Font.labelMedium)
                .foregroundStyle(Theme.textPrimary)
            TextField(String(localized: "Describe a clay object"), text: $direction, axis: .vertical)
                .lineLimit(2...4)
                .padding(10)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityIdentifier("phone-shape-avatar-generate-input")
            Button {
                Task { await generate() }
            } label: {
                Label(generating ? "Generating…" : "Generate", systemImage: "sparkles")
                    .font(Theme.Font.bodyMedium)
                    .frame(maxWidth: .infinity)
                    .frame(height: 40)
            }
            .buttonStyle(.borderedProminent)
            .disabled(generating || direction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityIdentifier("phone-shape-avatar-generate")
        }
    }

    private func actionButton(_ title: LocalizedStringKey, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(Theme.Font.labelMedium)
                .padding(.horizontal, 10)
                .frame(height: 32)
                .background(Theme.card, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("phone-shape-avatar-\(id)")
    }

    private func apply(_ def: ShapeAvatarDef, color: String? = nil, mood: String? = nil) {
        var next = draft.complete
        next.character = .shape
        if let id = def.id, let shape = MascotShape.stored(id), ShapeAvatarPresets.isObjectShape(shape) {
            next.shape = shape
        }
        next.avatarDef = def
        draft.look = next.stored
        if let color, MausColors.hex(for: color) != nil {
            draft.color = color
        }
        if let mood, let parsed = ShapeMood(rawValue: mood) {
            moodPreview = parsed
        }
        error = nil
        notice = mood.map { String(localized: "Imported (\($0)).") } ?? String(localized: "Shape updated.")
        Haptics.selection()
    }

    private func importText(_ raw: String) {
        let share = ShapeAvatarShareCodec.decode(raw)
        if case let .ok(def) = share.validation {
            apply(def, color: share.color, mood: share.mood)
            return
        }
        switch ShapeAvatarShareCodec.parsePayload(raw) {
        case let .ok(def):
            apply(def)
        case let .error(message):
            error = message
            notice = nil
        }
    }

    private func exportJSON() {
        guard let def = currentDef ?? Optional(ShapeAvatarGenerate.generate(direction: draft.complete.shape.rawValue)) else { return }
        guard let data = try? JSONEncoder().encode(def),
              let text = String(data: data, encoding: .utf8) else { return }
        shareText = text
        showShare = true
        notice = String(localized: "JSON ready to share.")
        error = nil
    }

    private func exportSVG() {
        guard let def = currentDef ?? Optional(ShapeAvatarGenerate.generate(direction: draft.complete.shape.rawValue)) else { return }
        let fill = MausColors.hex(for: draft.color) ?? "#3b82f6"
        shareText = ShapeAvatarPresets.stillSvg(def, fill: fill)
        showShare = true
        notice = String(localized: "SVG ready to share.")
        error = nil
    }

    private func prepareShare() {
        guard let def = currentDef ?? Optional(ShapeAvatarGenerate.generate(direction: draft.complete.shape.rawValue)) else { return }
        do {
            let payload = try ShapeAvatarShareCodec.encode(def, color: draft.color, mood: moodPreview.rawValue)
            shareText = payload
            UIPasteboard.general.string = payload
            showShare = true
            notice = String(localized: "Share payload copied.")
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func generate() async {
        let text = direction.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        generating = true
        defer { generating = false }
        // Prefer the bot route when available; fall back to local keyword mapping (tests never hit providers).
        if let botId = session.state.bots.first?.id, let client = session.profileClient {
            do {
                let def = try await client.generateShapeAvatar(botId: botId, direction: text)
                apply(def)
                direction = ""
                notice = String(localized: "Generated on the server.")
                return
            } catch {
                // Route may be missing on older servers.
            }
        }
        apply(ShapeAvatarGenerate.generate(direction: text))
        direction = ""
        notice = String(localized: "Generated locally (keyword match).")
    }
}

/// Thin share sheet wrapper used by the phone shape avatar panel.
private struct ShapeAvatarActivitySheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
