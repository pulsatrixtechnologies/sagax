// Shared pieces of the model menu's layout (#5051, #5338): the fixed icon
// zone, Optimize for on one line, reasoning levels that stay whole, and the
// composer's cascading system menus for Reasoning and All models.
import CompanionCore
import SwiftUI

struct ModelMenuSegment: Identifiable, Hashable {
    var id: String
    var title: String
    /// The title is an English catalog key. A label already resolved
    /// (an effort level's own words) is shown as given.
    var localize: Bool
}

/// The small segmented control: 24 pt track, 20 pt segments, labels on one
/// line up to four and on balanced lines after that. A label is never cut.
struct ModelMenuSegments: View {
    var idPrefix: String
    var label: String
    var options: [ModelMenuSegment]
    var selected: String
    var fill: Bool
    var ink: Color
    var secondary: Color
    var track: Color
    var chosen: Color
    var onPick: (String) -> Void

    var body: some View {
        let lines = ModelMenuLayout.segmentLines(options)
        VStack(spacing: 2) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                HStack(spacing: 2) {
                    ForEach(line) { option in
                        let on = option.id == selected
                        Button { onPick(option.id) } label: {
                            segmentLabel(option, on: on)
                                .lineLimit(1)
                                .fixedSize(horizontal: true, vertical: false)
                                .padding(.horizontal, 8)
                                .frame(maxWidth: fill || lines.count > 1 ? .infinity : nil)
                                .frame(height: 20)
                        }
                        .buttonStyle(.borderless)
                        .background(on ? chosen : Color.clear, in: Capsule())
                        .accessibilityAddTraits(on ? .isSelected : [])
                        .accessibilityIdentifier("\(idPrefix).\(option.id)")
                    }
                }
            }
        }
        .padding(2)
        .background(track, in: RoundedRectangle(cornerRadius: lines.count > 1 ? 12 : 999, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(label))
    }

    @ViewBuilder
    private func segmentLabel(_ option: ModelMenuSegment, on: Bool) -> some View {
        let text = option.localize ? Text(LocalizedStringKey(option.title)) : Text(verbatim: option.title)
        text
            .font(.system(size: 12, weight: on ? .medium : .regular))
            .foregroundStyle(on ? ink : secondary)
    }
}

/// "Optimize for" on one 32 pt line: the label at the names' edge, the small
/// control at the right. Not a heading, and not a full-width picker.
struct ModelMenuOptimizeLine: View {
    var selected: ModelAutoOptimize
    var idPrefix: String
    var ink: Color
    var secondary: Color
    var track: Color
    var chosen: Color
    var onPick: (ModelAutoOptimize) -> Void

    var body: some View {
        HStack(spacing: 12) {
            Text("Optimize for")
                .font(.system(size: 12))
                .foregroundStyle(secondary)
                .lineLimit(1)
            Spacer(minLength: 8)
            ModelMenuSegments(
                idPrefix: idPrefix,
                label: String(localized: "Optimize for"),
                options: ModelAutoOptimize.allCases.map {
                    ModelMenuSegment(id: $0.rawValue, title: $0.labelKey, localize: true)
                },
                selected: selected.rawValue,
                fill: false,
                ink: ink,
                secondary: secondary,
                track: track,
                chosen: chosen,
                onPick: { id in
                    if let value = ModelAutoOptimize(rawValue: id) { onPick(value) }
                }
            )
        }
        .frame(minHeight: 32)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Optimize for"))
        .accessibilityIdentifier(idPrefix)
    }
}

/// Every reasoning level the model takes, Default first, on balanced lines.
struct ModelMenuReasoning: View {
    var levels: [String]
    /// The stored level, or nil for Default.
    var selected: String?
    var idPrefix: String
    var ink: Color
    var secondary: Color
    var track: Color
    var chosen: Color
    var onPick: (String?) -> Void

    var body: some View {
        let options = [ModelMenuSegment(id: "default", title: "Default", localize: true)]
            + levels.map { ModelMenuSegment(id: $0, title: UltracodeEffort.label($0), localize: false) }
        let value = selected.flatMap { levels.contains($0) ? $0 : nil } ?? "default"
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text("Reasoning")
                    .font(.system(size: 12))
                    .foregroundStyle(secondary)
                    .layoutPriority(1)
                Spacer(minLength: 8)
                Text("More effort is slower")
                    .font(.system(size: 12))
                    .foregroundStyle(secondary)
                    .lineLimit(1)
            }
            ModelMenuSegments(
                idPrefix: idPrefix,
                label: String(localized: "Reasoning"),
                options: options,
                selected: value,
                fill: true,
                ink: ink,
                secondary: secondary,
                track: track,
                chosen: chosen,
                onPick: { id in onPick(id == "default" ? nil : id) }
            )
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(idPrefix)
    }
}

/// Reasoning as a system nested menu (#5338): the mode menu stays on screen.
struct ComposerCascadeReasoning<LabelContent: View>: View {
    let reasoning: ComposerModes.Reasoning
    let automatic: Bool
    let pickEffort: (String?) -> Void
    @ViewBuilder var label: () -> LabelContent

    var body: some View {
        Menu {
            ForEach(reasoning.choices, id: \.self) { level in
                Button {
                    pickEffort(level)
                } label: {
                    if level == reasoning.value {
                        Label(reasoning.label(level, automatic: automatic), systemImage: "checkmark")
                    } else {
                        Text(verbatim: reasoning.label(level, automatic: automatic))
                    }
                }
                .accessibilityIdentifier("model-reasoning.\(level ?? "default")")
            }
        } label: {
            label()
        }
        .disabled(reasoning.disabled)
        .accessibilityIdentifier("model-mode-reasoning")
    }
}

/// All models as cascading system menus (#5338): provider, then account, then
/// model. A provider with one account opens on its models. Favorites lead.
struct ComposerCascadeAllModels<LabelContent: View>: View {
    let list: ComposerModes.ManualList
    let favoriteKeys: [String]
    let onPick: (ModelMenuRow) -> Void
    let onStar: (ModelMenuRow) -> Void
    @ViewBuilder var label: () -> LabelContent

    var body: some View {
        Menu {
            ForEach(list.top) { row in
                modelButtons(row, star: false)
            }
            if !list.favorites.isEmpty {
                Section(String(localized: "Favorites")) {
                    ForEach(list.favorites) { row in
                        modelButtons(row, star: true)
                    }
                }
            }
            ForEach(list.providers) { provider in
                providerMenu(provider)
            }
        } label: {
            label()
        }
        .accessibilityIdentifier("model-all")
    }

    @ViewBuilder
    private func providerMenu(_ provider: ComposerModes.ManualProvider) -> some View {
        switch ComposerModes.open(provider) {
        case let .models(_, accountId):
            if let account = provider.accounts.first(where: { $0.id == accountId }) {
                Menu {
                    ForEach(account.rows) { modelButtons($0, star: true) }
                } label: {
                    providerLabel(provider.label, current: provider.current)
                }
                .accessibilityIdentifier("model-provider.\(provider.id)")
            }
        case .accounts(_):
            Menu {
                ForEach(provider.accounts) { account in
                    Menu {
                        ForEach(account.rows) { modelButtons($0, star: true) }
                    } label: {
                        providerLabel(account.label ?? provider.label, current: account.rows.contains(where: \.current))
                    }
                    .accessibilityIdentifier("model-account.\(account.id)")
                }
            } label: {
                providerLabel(provider.label, current: provider.current)
            }
            .accessibilityIdentifier("model-provider.\(provider.id)")
        case .root, .reasoning, .providers, .models(_, _):
            EmptyView()
        }
    }

    @ViewBuilder
    private func providerLabel(_ title: String, current: Bool) -> some View {
        if current {
            Label(title, systemImage: "checkmark")
        } else {
            Text(verbatim: title)
        }
    }

    @ViewBuilder
    private func modelButtons(_ row: ModelMenuRow, star: Bool) -> some View {
        Button {
            onPick(row)
        } label: {
            if row.current {
                Label(row.label, systemImage: "checkmark")
            } else {
                Text(verbatim: row.label)
            }
        }
        .accessibilityIdentifier("model-row.\(row.key)")
        if star, row.kind == .model {
            let starred = favoriteKeys.contains(row.key)
            Button {
                onStar(row)
            } label: {
                Label(
                    starred ? String(localized: "Remove \(row.label) from favorites") : String(localized: "Add \(row.label) to favorites"),
                    systemImage: starred ? "star.fill" : "star"
                )
            }
            .accessibilityIdentifier("model-favorite.\(row.instanceId ?? "").\(row.modelId ?? "")")
        }
    }
}
