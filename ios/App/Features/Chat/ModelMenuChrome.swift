// Shared pieces of the model menu's layout (#5051): the fixed icon zone,
// Optimize for on one line, and reasoning levels that stay whole.
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

/// The same drill-down rows in the phone sheet and the iPad popover.
struct ComposerMenuPanel<ModelRow: View>: View {
    @Binding var panel: ComposerModes.Panel
    let list: ComposerModes.ManualList
    let reasoning: ComposerModes.Reasoning
    let automatic: Bool
    let pickEffort: (String?) -> Void
    @ViewBuilder var modelRow: (ModelMenuRow) -> ModelRow

    private var visiblePanel: ComposerModes.Panel { ComposerModes.settle(panel, providers: list.providers) }

    private var heading: String {
        switch visiblePanel {
        case .root, .providers: return String(localized: "All models")
        case .reasoning: return String(localized: "Reasoning")
        case let .accounts(id): return list.providers.first { $0.id == id }?.label ?? ""
        case let .models(id, accountId):
            guard let provider = list.providers.first(where: { $0.id == id }) else { return "" }
            let account = provider.accounts.first { $0.id == accountId }
            return [provider.label, provider.accounts.count > 1 ? account?.label : nil].compactMap { $0 }.joined(separator: " · ")
        }
    }

    var body: some View {
        Button {
            panel = ComposerModes.back(visiblePanel, providers: list.providers)
        } label: {
            Label { Text(verbatim: heading) } icon: { Image(systemName: "chevron.left") }
        }
        .accessibilityLabel(Text("Back"))
        .accessibilityIdentifier("model-menu-back")
        switch visiblePanel {
        case .providers:
            ForEach(list.top) { modelRow($0) }
            if !list.favorites.isEmpty {
                Text("Favorites").font(.caption).foregroundStyle(.secondary)
                ForEach(list.favorites) { modelRow($0) }
            }
            ForEach(list.providers) { provider in
                link(provider.label, current: provider.current) { panel = ComposerModes.open(provider) }
                    .accessibilityIdentifier("model-provider.\(provider.id)")
            }
        case let .accounts(id):
            if let provider = list.providers.first(where: { $0.id == id }) {
                ForEach(provider.accounts) { account in
                    link(account.label ?? provider.label, current: account.rows.contains(where: \.current)) { panel = .models(id, account.id) }
                        .accessibilityIdentifier("model-account.\(account.id)")
                }
            }
        case let .models(id, accountId):
            if let provider = list.providers.first(where: { $0.id == id }),
               let account = provider.accounts.first(where: { $0.id == accountId }) {
                ForEach(account.rows) { modelRow($0) }
            }
        case .reasoning:
            ForEach(reasoning.choices, id: \.self) { level in
                Button { pickEffort(level) } label: {
                    HStack {
                        Text(verbatim: reasoning.label(level, automatic: automatic))
                        Spacer()
                        if level == reasoning.value { Image(systemName: "checkmark").accessibilityHidden(true) }
                    }
                    .contentShape(Rectangle())
                }
                .accessibilityAddTraits(level == reasoning.value ? .isSelected : [])
                .accessibilityIdentifier("model-reasoning.\(level ?? "default")")
            }
        case .root: EmptyView()
        }
    }

    private func link(_ title: String, current: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(verbatim: title)
                Spacer()
                if current { Image(systemName: "checkmark") }
                Image(systemName: "chevron.right").foregroundStyle(.secondary)
            }
            .contentShape(Rectangle())
        }
        .accessibilityAddTraits(current ? .isSelected : [])
    }
}
