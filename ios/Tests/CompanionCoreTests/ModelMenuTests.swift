// The model menu's rules (src/lib/model-menu.test.ts, model-favorites.test.ts,
// model-health.test.ts): providers in submenus, favorites under Auto, only
// the models that run, and Simple's one "All models" row.
import XCTest
@testable import CompanionCore

final class ModelMenuTests: XCTestCase {
    private let labels = ModelMenuLabels(
        auto: "Auto", autoHint: "best model per task", useBotModel: { "Use \($0)'s model" },
        local: "Local", defaultTag: "Default", loadedTag: "Loaded"
    )

    private func instance(_ id: String, state: String = "available", authenticated: Bool? = true, models: [(String, String)], local: Bool = false, server: String? = nil, sharedBy: String? = nil) -> Instance {
        let options = models.map { ModelOption(id: $0.0, label: $0.1, custom: local ? true : nil, local: local ? true : nil, server: server, sharedBy: sharedBy) }
        return Instance(
            instanceId: id, driverKind: id, displayName: id.capitalized,
            snapshot: ProviderSnapshot(state: state, authenticated: authenticated),
            models: ModelCatalog(default: models.first?.0 ?? "", options: options)
        )
    }

    private var instances: [Instance] {
        [
            instance("claude", models: [("sonnet", "Sonnet"), ("opus", "Opus")]),
            instance("codex", authenticated: false, models: [("gpt", "GPT")]),
            instance("qwen", state: "missing", models: [("coder", "Coder")]),
            instance("pi", models: [("ds::llama", "Llama")], local: true, server: "DwarfStar"),
            instance("grok", models: [("ds::llama", "Llama")], local: true),
        ]
    }

    private func sections(selection: ModelSelection, follows: Bool? = nil) -> [ModelMenuSection] {
        ModelMenu.sections(
            instances: instances, selection: selection, botModel: ModelSelection(instanceId: "claude", model: "sonnet"),
            botName: "Ara", follows: follows, organization: false, allowedEngines: nil, labels: labels,
            engineLabel: { $0.displayName ?? $0.instanceId }
        )
    }

    func testOnlyTheModelsThatRunAreOffered() {
        let menu = sections(selection: ModelSelection(instanceId: "claude", model: "opus"))
        XCTAssertEqual(menu.map(\.key), ["top", "claude", ModelMenu.localSectionKey], "signed out and not installed providers go")
        XCTAssertEqual(menu[1].rows.map(\.modelId), ["sonnet", "opus"])
        XCTAssertEqual(menu[1].rows.first { $0.current }?.modelId, "opus")
        XCTAssertEqual(menu[2].rows.map(\.label), ["Llama"], "a local model once, by its name alone")
        XCTAssertEqual(menu[2].rows.first?.detail, "DwarfStar")
    }

    func testASharedLocalModelNamesWhoSharesIt() {
        let option = ModelOption(id: "d::ornith", label: "Ornith-1.5-122B-oQ4e-mtp", custom: true, local: true, sharedBy: "Camille Tremblay")
        XCTAssertEqual(option.label, "Ornith-1.5-122B-oQ4e-mtp", "the name stays whole, no suffix")
        XCTAssertTrue(option.subtext?.contains("Camille Tremblay") == true, option.subtext ?? "")
        XCTAssertEqual(option.id, "d::ornith", "the technical id stays")
        XCTAssertNil(ModelOption(id: "d::ornith", label: "Ornith-1.5-122B-oQ4e-mtp").subtext)
        XCTAssertEqual(ModelOption(id: "d::g", label: "Gemma-4", server: "oMLX").subtext, "oMLX")
    }

    func testTheModelInUseStaysAndSaysItDoesNotRespond() {
        let menu = sections(selection: ModelSelection(instanceId: "codex", model: "gpt"))
        let codex = menu.first { $0.key == "codex" }
        XCTAssertEqual(codex?.rows.map(\.modelId), ["gpt"])
        XCTAssertEqual(codex?.rows.first?.notResponding, true)
        XCTAssertEqual(sections(selection: ModelSelection(instanceId: "qwen", model: "coder")).first { $0.key == "qwen" }?.rows.first?.current, true)
    }

    func testRootFavoritesAndCurrent() {
        let menu = sections(selection: ModelSelection(instanceId: "claude", model: "opus"), follows: false)
        let opus = ModelFavorites.key(instanceId: "claude", modelId: "opus")
        let sonnet = ModelFavorites.key(instanceId: "claude", modelId: "sonnet")
        var root = ModelMenu.root(menu, favorites: [sonnet, "gone/model"])
        XCTAssertEqual(root.top.map(\.key), ["auto", "follow"])
        XCTAssertEqual(root.current?.key, opus, "the current model shows when no top row is checked")
        XCTAssertEqual(root.favorites.map(\.key), [sonnet], "a favorite that is gone is not shown")
        XCTAssertEqual(root.providers.map(\.id), ["claude", ModelMenu.localSectionKey])
        XCTAssertEqual(root.providers.first?.current, true)
        root = ModelMenu.root(menu, favorites: [opus])
        XCTAssertNil(root.current, "a starred current model shows once, among the favorites")
        var autoSelection = ModelSelection(instanceId: "claude", model: "opus")
        autoSelection.auto = true
        let auto = ModelMenu.root(sections(selection: autoSelection), favorites: [])
        XCTAssertNil(auto.current)
        XCTAssertTrue(auto.top[0].current)
    }

    func testSearchListsMatchesFlat() {
        let menu = sections(selection: ModelSelection(instanceId: "claude", model: "opus"))
        XCTAssertEqual(ModelMenu.filter(menu, query: "OPUS").flatMap(\.rows).map(\.modelId), ["opus"])
        XCTAssertEqual(ModelMenu.filter(menu, query: "claude son").flatMap(\.rows).map(\.modelId), ["sonnet"])
        XCTAssertEqual(ModelMenu.fold("Élevé"), "eleve")
    }

    func testFavoritesAreTheServersKeysAndToggle() {
        let key = ModelFavorites.key(instanceId: "claude", modelId: "opus")
        XCTAssertEqual(key, "claude/opus", "the desktop's modelKey")
        XCTAssertEqual(ModelFavorites.clean(["claude/opus", "claude/opus", "nosep", "/x", "x/", "or/vendor/model"]), ["claude/opus", "or/vendor/model"])
        XCTAssertEqual(ModelFavorites.clean((0..<50).map { "e/m\($0)" }).count, ModelFavorites.max)
        XCTAssertEqual(ModelFavorites.clean((0..<50).map { "e/m\($0)" }).last, "e/m49", "the newest are kept")
        XCTAssertEqual(ModelFavorites.toggled([], key), [key])
        XCTAssertEqual(ModelFavorites.toggled([key], key), [])
        XCTAssertEqual(ModelFavorites.toggled([], "no-separator"), [])
    }

    func testTheDevicesOldRecordMovesToServerKeys() {
        XCTAssertEqual(ModelFavorites.parseLegacy(#"[["claude","opus"],["claude","opus"],["x"],5,["",""]]"#), ["claude/opus"])
        XCTAssertEqual(ModelFavorites.parseLegacy("not json"), [])
        XCTAssertEqual(ModelFavorites.parseLegacy(nil), [])
    }

    func testAdvancedIsTheDefaultForEveryone() {
        XCTAssertFalse(ModelMenu.isSimple(stored: nil))
        XCTAssertFalse(ModelMenu.isSimple(stored: "advanced"))
        XCTAssertFalse(ModelMenu.isSimple(stored: "1"))
        XCTAssertTrue(ModelMenu.isSimple(stored: "simple"))
    }
    func testDisabledModelsFromBothLevelsStayOutOfEveryMenu() throws {
        let config = try JSONDecoder().decode(ConfigStatus.self, from: Data(#"{"disabledModels":["claude/opus"],"myDisabledModels":["claude/sonnet"]}"#.utf8))
        XCTAssertEqual(config.disabledModels, ["claude/opus"])
        XCTAssertEqual(config.myDisabledModels, ["claude/sonnet"])
        let menu = ModelMenu.sections(
            instances: instances, selection: ModelSelection(instanceId: "claude", model: "opus"),
            botModel: ModelSelection(instanceId: "claude", model: "sonnet"), botName: "Ara", follows: false,
            organization: true, allowedEngines: nil, disabledModels: config.disabledModels,
            myDisabledModels: config.myDisabledModels, labels: labels, engineLabel: { $0.instanceId }
        )
        let rows = menu.flatMap(\.rows)
        XCTAssertFalse(rows.contains { $0.instanceId == "claude" })
        XCTAssertFalse(rows.contains { $0.kind == .follow })
        let favorites = ModelMenu.root(menu, favorites: [ModelFavorites.key(instanceId: "claude", modelId: "opus")])
        XCTAssertTrue(favorites.favorites.isEmpty)
        XCTAssertTrue(ModelMenu.filter(menu, query: "opus").isEmpty)
        let older = try JSONDecoder().decode(ConfigStatus.self, from: Data("{}".utf8))
        XCTAssertNil(older.disabledModels)
        XCTAssertNil(older.myDisabledModels)
    }

    func testPersonalSwitchesApplyInSoloAndModelIdsMayContainSlashes() {
        let endpoint = instance("compat", models: [("vendor/large", "Large"), ("vendor/small", "Small")])
        let menu = ModelMenu.sections(
            instances: [endpoint], selection: ModelSelection(instanceId: "compat", model: "vendor/small"),
            botModel: ModelSelection(instanceId: "compat", model: "vendor/small"), botName: "Ara", follows: nil,
            organization: false, allowedEngines: nil, myDisabledModels: ["compat/vendor/large"],
            labels: labels, engineLabel: { $0.instanceId }
        )
        XCTAssertEqual(menu.filter { $0.key == "compat" }.flatMap(\.rows).map(\.modelId), ["vendor/small"])
    }
}
