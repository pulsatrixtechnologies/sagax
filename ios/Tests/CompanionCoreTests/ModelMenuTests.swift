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

    func testReasoningLevelsStayWholeOnBalancedLines() {
        XCTAssertEqual(ModelMenuLayout.segmentsPerLine, 4)
        XCTAssertEqual(ModelMenuLayout.segmentLines([1, 2, 3]).map(\.count), [3])
        XCTAssertEqual(ModelMenuLayout.segmentLines([1, 2, 3, 4]).map(\.count), [4])
        XCTAssertEqual(ModelMenuLayout.segmentLines([1, 2, 3, 4, 5]).map(\.count), [3, 2])
        XCTAssertEqual(ModelMenuLayout.segmentLines([1, 2, 3, 4, 5, 6, 7]).map(\.count), [4, 3])
        XCTAssertEqual(ModelMenuLayout.segmentLines([1, 2, 3, 4, 5, 6, 7, 8]).map(\.count), [4, 4])
        XCTAssertEqual(ModelMenuLayout.segmentLines([1, 2, 3, 4, 5, 6, 7, 8, 9]).map(\.count), [3, 3, 3])
        XCTAssertEqual(ModelMenuLayout.sideSlot, 20)
        XCTAssertEqual(ModelMenuLayout.iconSlot, 28)
    }

    func testOnlyTheModelsThatRunAreOffered() {
        let menu = sections(selection: ModelSelection(instanceId: "claude", model: "opus"))
        XCTAssertEqual(menu.map(\.key), ["top", "claude", ModelMenu.localSectionKey], "signed out and not installed providers go")
        XCTAssertEqual(menu[1].rows.map(\.modelId), ["sonnet", "opus"])
        XCTAssertEqual(menu[1].rows.first { $0.current }?.modelId, "opus")
        XCTAssertEqual(menu[2].rows.map(\.label), ["Llama"], "a local model once, by its name alone")
        XCTAssertEqual(menu[2].rows.first?.detail, "DwarfStar")
    }

    // M-20261119-015: two Claude accounts, each with its own list: every row
    // says its account, and a model only one of them offers wears the badge
    func testTwoAccountsNameTheirRowsAndAModelOnlyOneOffersWearsTheBadge() {
        func account(_ id: String, name: String, email: String?, models: [(String, String)]) -> Instance {
            Instance(
                instanceId: id, driverKind: "claudeAgent", displayName: name,
                snapshot: ProviderSnapshot(state: "available", authenticated: true, account: email.map { ProviderSnapshotAccount(email: $0) }),
                models: ModelCatalog(default: models.first?.0 ?? "", options: models.map { ModelOption(id: $0.0, label: $0.1) })
            )
        }
        let personal = account("claude-personal", name: "Claude Code", email: "ada@example.com", models: [("opus", "Opus"), ("fable", "Fable")])
        let team = account("claude-team", name: "Team", email: "ada@acme.test", models: [("mythos", "Mythos"), ("opus", "Opus"), ("fable", "Fable")])
        let menu = ModelMenu.sections(
            instances: [personal, team], selection: ModelSelection(instanceId: "claude-personal", model: "opus"),
            botModel: ModelSelection(instanceId: "claude-personal", model: "opus"), botName: "Ara", follows: nil,
            organization: false, allowedEngines: nil, labels: labels, engineLabel: { _ in "Claude" }
        )
        let personalRows = menu.first { $0.key == "claude-personal" }!.rows
        let teamRows = menu.first { $0.key == "claude-team" }!.rows
        // a tool's name never names an account: the address does
        XCTAssertEqual(Set(personalRows.map(\.account)), ["ada@example.com"])
        XCTAssertEqual(Set(teamRows.map(\.account)), ["Team"])
        XCTAssertEqual(menu.first { $0.key == "claude-team" }?.label, "Claude · Team")
        // offered by both: no badge; offered by the team account alone: the badge
        XCTAssertNil(teamRows.first { $0.modelId == "opus" }?.badge)
        XCTAssertNil(personalRows.first { $0.modelId == "opus" }?.badge)
        XCTAssertEqual(teamRows.first { $0.modelId == "mythos" }?.badge, "Special access")
        XCTAssertEqual(teamRows.first { $0.modelId == "mythos" }?.badgeHint, "Only Team offers this model")
        XCTAssertEqual(ModelMenu.accountLabel(team, among: [personal, team], labels: labels, engineLabel: { _ in "Claude" }), "Team")
        // one account: nothing to tell apart
        let alone = ModelMenu.sections(
            instances: [team], selection: ModelSelection(instanceId: "claude-team", model: "opus"),
            botModel: ModelSelection(instanceId: "claude-team", model: "opus"), botName: "Ara", follows: nil,
            organization: false, allowedEngines: nil, labels: labels, engineLabel: { _ in "Claude" }
        )
        XCTAssertTrue(alone.flatMap(\.rows).allSatisfy { $0.account == nil && $0.badge == nil })
    }

    // M-20261119-015: one connected account beside a signed-out one the bot
    // still runs on: the badge reads the accounts' own lists, never on every model
    func testOneConnectedAccountBesideASignedOutOneBadgesNothing() {
        let models = [ModelOption(id: "opus", label: "Opus"), ModelOption(id: "fable", label: "Fable"), ModelOption(id: "sonnet", label: "Sonnet")]
        let old = Instance(
            instanceId: "claude-old", driverKind: "claudeAgent", displayName: "Old",
            snapshot: ProviderSnapshot(state: "available", authenticated: false),
            models: ModelCatalog(default: "opus", options: models)
        )
        let team = Instance(
            instanceId: "claude-team", driverKind: "claudeAgent", displayName: "Team",
            snapshot: ProviderSnapshot(state: "available", authenticated: true),
            models: ModelCatalog(default: "opus", options: models)
        )
        let menu = ModelMenu.sections(
            instances: [old, team], selection: ModelSelection(instanceId: "claude-old", model: "opus"),
            botModel: ModelSelection(instanceId: "claude-old", model: "opus"), botName: "Ara", follows: nil,
            organization: false, allowedEngines: nil, labels: labels, engineLabel: { _ in "Claude" }
        )
        let rows = menu.flatMap(\.rows).filter { $0.kind == .model }
        XCTAssertTrue(rows.allSatisfy { $0.badge == nil }, rows.map { "\($0.instanceId ?? ""):\($0.modelId ?? "")=\($0.badge ?? "-")" }.joined(separator: ", "))
        XCTAssertEqual(menu.first { $0.key == "claude-team" }?.rows.first?.account, "Team")
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
