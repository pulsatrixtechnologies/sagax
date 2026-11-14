// "When something changes in a product" (#4250): the watched resources, as
// the desktop's ProductTriggerFields (src/components/routines/ProductTriggerFields.tsx)
// lays them out: the field (one address per line), its hint, then what the
// viewer can watch, as Perspicax lists it, one tap to add. A template's
// {...} part is filled in the field. The form builds the schedule.
import CompanionCore
import SwiftUI

struct RoutineProductTriggerFields: View {
    @Binding var form: RoutineScheduleForm
    let watchable: [WatchableResource]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Watched resources").font(.subheadline)
            TextField(String(localized: "Watched resources"), text: $form.productResources,
                      prompt: Text(verbatim: "perspicax://cw/boards/12/open"), axis: .vertical)
                .lineLimit(2...5)
                .font(.footnote.monospaced())
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("routine-editor-product-resources")
            Text("One per line, as Perspicax lists it. The routine runs only when one of them changes.")
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
        }
        if !watchable.isEmpty {
            Menu {
                let resources = watchable.filter { !$0.template }
                let templates = watchable.filter(\.template)
                if !resources.isEmpty {
                    Section { suggestions(resources) }
                }
                if !templates.isEmpty {
                    Section(String(localized: "To complete: fill in the {...} part in the field")) { suggestions(templates) }
                }
            } label: {
                Label(String(localized: "You can watch (\(watchable.count))"), systemImage: "plus.circle")
            }
            .accessibilityIdentifier("routine-editor-product-watchable")
        }
    }

    private func suggestions(_ entries: [WatchableResource]) -> some View {
        let chosen = RoutineScheduleForm.productURIs(form.productResources)
        return ForEach(entries) { entry in
            Button {
                form.addProductResource(entry.uri)
            } label: {
                if chosen.contains(entry.uri) {
                    Label(entry.label, systemImage: "checkmark")
                } else {
                    Text(verbatim: entry.label)
                }
            }
        }
    }
}
