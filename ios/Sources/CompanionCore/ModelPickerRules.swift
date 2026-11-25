// A model choice updates the bot and every existing conversation silently.
// Thread-specific low-level API choices remain readable until the next bot change.
import Foundation

public enum ModelPickerRules {
    /// `modelSelectionForPick`: switching models never carries an opaque
    /// variant from the previous model; the effort stays on the same engine
    /// when the new model takes it (`ModelEffort`).
    public static func selectionForPick(_ selection: ModelSelection, instance: Instance, model: String, pinAccount: Bool = false) -> ModelSelection {
        var next = ModelSelection(instanceId: instance.instanceId, model: model)
        if pinAccount { next.accountPinned = true }
        if instance.instanceId == selection.instanceId {
            if instance.capabilities?.modelVariants == true {
                if model == selection.model, let variant = selection.variant { next.variant = variant }
            } else {
                // a level the new model does not take is dropped: its default runs
                // (an engine that did not say its levels keeps it, as before)
                let option = instance.models.options.first { $0.id == model }
                next.effort = instance.capabilities?.effortLevels.map { ModelEffort.forModel(selection.effort, option: option, engine: $0) }
                    ?? selection.effort.flatMap { $0.isEmpty ? nil : $0 }
            }
        }
        return next
    }

    /// A model on the person's own computer (`desk<id>::model`).
    public static func isDesktopModelId(_ id: String) -> Bool {
        guard let separator = id.range(of: "::"), separator.lowerBound > id.startIndex else { return false }
        return id[..<separator.lowerBound].range(of: #"^desk[a-z0-9]{3,24}$"#, options: .regularExpression) != nil
    }

    /// The dropdown's two groups. Local: models on this machine (solo) or
    /// on the person's own computer (organization), and a local server's
    /// (`server::model`), loaded ones first. Cloud: everything else. An
    /// organization server never lists its own custom models.
    public static func groups(_ options: [ModelOption], organization: Bool) -> (cloud: [ModelOption], local: [ModelOption]) {
        func isLocal(_ option: ModelOption) -> Bool {
            let localRow = organization ? isDesktopModelId(option.id) : (option.local == true || isDesktopModelId(option.id))
            return localRow || (option.custom == true && option.id.contains("::"))
        }
        let offered = organization ? options.filter { $0.custom != true || isDesktopModelId($0.id) } : options
        let local = offered.filter(isLocal)
        return (offered.filter { !isLocal($0) }, local.filter { $0.loaded == true } + local.filter { $0.loaded != true })
    }

    /// `engineAllowed`: nil allows every engine; an empty list allows none
    /// (2026-10-17, shared/org-allowed-engines.ts).
    public static func engineAllowed(_ allowed: [String]?, _ instanceId: String) -> Bool {
        guard let allowed else { return true }
        return allowed.contains(instanceId)
    }

    /// The providers listed: on an organization server the allowed ones,
    /// plus the bot's current one (shown, not selectable) so its state is
    /// explained.
    public static func listed(_ instances: [Instance], allowed: [String]?, organization: Bool, selectedId: String) -> [Instance] {
        guard organization else { return instances }
        return instances.filter { engineAllowed(allowed, $0.instanceId) || $0.instanceId == selectedId }
    }
}
