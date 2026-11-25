import XCTest
@testable import CompanionCore

/// #5091: the composer's modes on the phone and the iPad (the desktop's #5088),
/// and the Heavy run's row (#5089, #5090).
final class ComposerModesTests: XCTestCase {
    func testTheModeOfASelection() {
        XCTAssertNil(ComposerModes.mode(of: ModelSelection(instanceId: "claude", model: "opus")))
        XCTAssertEqual(ComposerModes.mode(of: ModelSelection(instanceId: "claude", model: "opus", auto: true)), .auto)
        XCTAssertEqual(ComposerModes.mode(of: ModelSelection(instanceId: "claude", model: "opus", auto: true, mode: "heavy")), .heavy)
        // Build round-trips from desktop; a mode without Auto is a pinned model
        XCTAssertEqual(ComposerModes.mode(of: ModelSelection(instanceId: "claude", model: "opus", auto: true, mode: "build")), .build)
        XCTAssertNil(ComposerModes.mode(of: ModelSelection(instanceId: "claude", model: "opus", mode: "fast")))
    }

    func testAModeKeepsTheBotsEngineAndAutoKeepsItsOptimize() {
        let pinned = ModelSelection(instanceId: "claude", model: "opus", effort: "high", variant: "thinking")
        let expert = ComposerModes.selection(pinned, for: .expert)
        XCTAssertEqual(expert.instanceId, "claude")
        XCTAssertEqual(expert.model, "opus")
        XCTAssertEqual(expert.auto, true)
        XCTAssertEqual(expert.mode, "expert")
        XCTAssertNil(expert.variant)
        let auto = ComposerModes.selection(expert, for: .auto)
        XCTAssertNil(auto.mode)
        XCTAssertEqual(auto.autoOptimize, .balance)
    }

    func testTheSelectionKeepsTheModeOnTheWayBack() throws {
        let decoded = try JSONDecoder().decode(ModelSelection.self, from: Data(#"{"instanceId":"claude","model":"opus","auto":true,"mode":"build"}"#.utf8))
        XCTAssertEqual(decoded.mode, "build")
        let again = try JSONDecoder().decode(ModelSelection.self, from: JSONEncoder().encode(decoded))
        XCTAssertEqual(again.mode, "build")
    }

    func testAvailableModesAndImposedReasoning() throws {
        let preview = try JSONDecoder().decode(ComposerModes.Preview.self, from: Data(#"{"modes":{"expert":{"effort":"high","pick":{"instanceId":"one","model":"m"}},"build":{"pick":null}}}"#.utf8))
        XCTAssertEqual(ComposerModes.offered(nil), [.auto, .fast, .expert, .heavy, .build])
        XCTAssertEqual(ComposerModes.offered(preview), [.auto, .expert])
        var selection = ModelSelection(instanceId: "one", model: "m", auto: true, mode: "expert")
        let imposed = ComposerModes.reasoning(selection: selection, instances: [], preview: preview)
        XCTAssertTrue(imposed.shown)
        XCTAssertTrue(imposed.disabled)
        XCTAssertEqual(imposed.value, "high")
        XCTAssertTrue(imposed.choices.isEmpty)
        selection.mode = "fast"
        XCTAssertFalse(ComposerModes.reasoning(selection: selection, instances: [], preview: preview).shown)
    }

    func testAutoAndBuildUseTheLevelsOfTheirResolvedModel() {
        var instance = engine("coder", family: "coding", email: nil, models: [("code", "Code")])
        instance.capabilities = InstanceCapabilities(effortLevels: ["low", "high"])
        instance.models.options[0].defaultEffort = "high"
        let pick = ComposerModes.Preview.Pick(instanceId: "coder", model: "code")
        let preview = ComposerModes.Preview(modes: ["build": .init(pick: pick)], pick: pick)
        var selection = ModelSelection(instanceId: "fallback", model: "old", effort: "invalid", auto: true)
        let automatic = ComposerModes.reasoning(selection: selection, instances: [instance], preview: preview)
        XCTAssertTrue(automatic.shown)
        XCTAssertFalse(automatic.disabled)
        XCTAssertNil(automatic.value)
        XCTAssertEqual(automatic.choices, [nil, "low", "high", UltracodeEffort.id])
        selection.mode = "build"
        let build = ComposerModes.reasoning(selection: selection, instances: [instance], preview: preview)
        XCTAssertEqual(build.value, "high")
        XCTAssertEqual(build.choices, ["low", "high", UltracodeEffort.id])
        selection.effort = "low"
        XCTAssertEqual(ComposerModes.reasoning(selection: selection, instances: [instance], preview: preview).value, "low")
    }

    func testLocalServersAndFollowRespectModelAvailability() {
        var local = engine("local", family: "local", email: nil, models: [("one", "One"), ("two", "Two")])
        local.models.options[0].local = true
        local.models.options[0].server = "Studio"
        local.models.options[1].local = true
        let work = engine("claude-work", family: "claudeAgent", email: nil, models: [("opus", "Opus")])
        let all = manual([work, local], selection: ModelSelection(instanceId: "claude-work", model: "opus"), favorites: ["claude-work/opus"])
        let list = ComposerModes.usable(all, thisComputer: "This computer", excluded: [.init(instanceId: "claude-work", model: "opus", reason: "refused")])
        XCTAssertTrue(list.top.isEmpty)
        XCTAssertTrue(list.favorites.isEmpty)
        XCTAssertEqual(list.providers.map(\.label), ["Local"])
        let accounts = list.providers[0].accounts
        XCTAssertEqual(accounts.map(\.label), ["Studio", "This computer"])
        XCTAssertNil(accounts[0].rows[0].detail)
    }

    func testVariantsChangeTheVariantAndPreserveTheAccount() {
        var instance = engine("code", family: "code", email: nil, models: [("m", "Code")])
        instance.capabilities = InstanceCapabilities(modelVariants: true)
        instance.models.options[0].variants = [.init(id: "deep", label: "Deep")]
        var selection = ModelSelection(instanceId: "code", model: "m")
        selection.accountPinned = true
        let row = ComposerModes.reasoning(selection: selection, instances: [instance], preview: nil)
        XCTAssertTrue(row.shown)
        XCTAssertEqual(row.choices, [nil, "deep"])
        let pick = row.choosing("deep", in: selection)
        XCTAssertEqual(pick.variant, "deep")
        XCTAssertEqual(pick.accountPinned, true)
        XCTAssertNil(pick.effort)
    }

    func testTheSameOrganizationCatalogUsesEachPersonsCredentials() {
        let instances = [engine("work", family: "grokAgent", email: nil, authenticated: false, models: [("one", "One"), ("two", "Two")])]
        func access(_ turns: String) -> [MyEngine] {
            [.init(instanceId: "work", driver: "grokAgent", displayName: "Grok", installed: true, subscription: .init(supported: true, signedIn: turns == "subscription"), myKey: false, orgKey: false, myTurns: turns)]
        }
        let signedIn = ComposerModes.organizationInstances(instances, mine: access("subscription"), models: ["work": ["two"]], allowed: [], ownOutside: true)
        XCTAssertEqual(signedIn.first?.models.options.map(\.id), ["two"])
        XCTAssertTrue(ComposerModes.organizationInstances(instances, mine: access("none"), models: [:], allowed: nil, ownOutside: true).isEmpty)
        XCTAssertTrue(ComposerModes.organizationInstances(instances, mine: access("subscription"), models: [:], allowed: [], ownOutside: false).isEmpty)
    }

    func testRunnableCascadeAndBackNavigation() {
        let instances = [
            engine("work", family: "claudeAgent", email: "work@example.test", models: [("opus", "Opus")]),
            engine("home", family: "claudeAgent", email: "home@example.test", models: [("opus", "Opus")]),
            engine("old", family: "claudeAgent", email: nil, authenticated: false, models: [("opus", "Opus")]),
            engine("grok", family: "grok", email: nil, models: [("g", "G")]),
            engine("gone", family: "offline", email: nil, state: "missing", models: [("g", "G")])
        ]
        let all = manual(instances, selection: ModelSelection(instanceId: "work", model: "opus"))
        let list = ComposerModes.usable(all, thisComputer: "This computer")
        let limited = ComposerModes.usable(all, thisComputer: "This computer", excluded: [.init(instanceId: "work", model: nil, reason: "limit")])
        XCTAssertEqual(limited.providers[0].accounts.map(\.id), ["home"])
        XCTAssertEqual(list.providers.map(\.id), ["Claude", "Grok"])
        XCTAssertEqual(list.providers[0].accounts.map(\.id), ["work", "home"])
        XCTAssertTrue(list.providers[0].current)
        XCTAssertFalse(list.providers[0].accounts[0].rows[0].pinAccount)
        XCTAssertTrue(list.providers[0].accounts[1].rows[0].pinAccount)
        let alternative = ModelPickerRules.selectionForPick(ModelSelection(instanceId: "work", model: "opus"), instance: instances[1], model: "opus", pinAccount: true)
        XCTAssertEqual(alternative.accountPinned, true)
        XCTAssertEqual(alternative.instanceId, "home")
        XCTAssertEqual(ComposerModes.open(list.providers[0]), .accounts("Claude"))
        XCTAssertEqual(ComposerModes.open(list.providers[1]), .models("Grok", "grok"))
        XCTAssertEqual(ComposerModes.back(.models("Grok", "grok"), providers: list.providers), .providers)
        XCTAssertEqual(ComposerModes.back(.models("Claude", "home"), providers: list.providers), .accounts("Claude"))
        XCTAssertEqual(ComposerModes.back(.accounts("Claude"), providers: list.providers), .providers)
        XCTAssertEqual(ComposerModes.settle(.accounts("Grok"), providers: list.providers), .models("Grok", "grok"))
        XCTAssertEqual(ComposerModes.settle(.models("Claude", "old"), providers: list.providers), .accounts("Claude"))
        XCTAssertEqual(ComposerModes.settle(.accounts("gone"), providers: list.providers), .providers)
        XCTAssertEqual(ComposerModes.back(.reasoning, providers: list.providers), .root)
    }

    private func engine(_ id: String, family: String, email: String?, state: String = "available", authenticated: Bool = true, models: [(String, String)]) -> Instance {
        Instance(
            instanceId: id, driverKind: family, displayName: family == "claudeAgent" ? "Claude Code" : family.capitalized,
            snapshot: ProviderSnapshot(state: state, authenticated: authenticated, account: email.map { ProviderSnapshotAccount(email: $0) }),
            models: ModelCatalog(default: models.first?.0 ?? "", options: models.map { ModelOption(id: $0.0, label: $0.1) })
        )
    }

    private let labels = ModelMenuLabels(
        auto: "Auto", autoHint: "best model per task", useBotModel: { "Use \($0)'s model" },
        local: "Local", defaultTag: "Default", loadedTag: "Loaded"
    )

    private func manual(_ instances: [Instance], selection: ModelSelection, favorites: [String] = [], organization: Bool = false) -> ComposerModes.ManualList {
        let family = { (instance: Instance) in instance.driverKind == "claudeAgent" ? "Claude" : (instance.displayName ?? instance.instanceId) }
        let sections = ModelMenu.sections(
            instances: instances, selection: selection, botModel: ModelSelection(instanceId: "claude-work", model: "opus"),
            botName: "Ara", follows: false, organization: organization, allowedEngines: nil, labels: labels, engineLabel: family
        )
        return ComposerModes.manual(
            sections, favorites: favorites, instances: instances, allowedEngines: nil, organization: organization,
            selectedId: selection.instanceId, labels: labels, engineLabel: family
        )
    }

    // D-20261119-083: every model by provider, then by account with its state, the favorites first
    func testManualListsEachProvidersAccountsWithTheirState() {
        let instances = [
            engine("claude-work", family: "claudeAgent", email: "ada.admin@acme.test", models: [("mythos", "Mythos"), ("opus", "Opus")]),
            engine("grok", family: "grok", email: nil, models: [("grok-4", "Grok 4")]),
            engine("claude-home", family: "claudeAgent", email: "ada@example.com", models: [("opus", "Opus"), ("fable", "Fable")]),
            engine("claude-old", family: "claudeAgent", email: "old@example.com", authenticated: false, models: [("opus", "Opus")]),
            engine("qwen", family: "qwen", email: nil, state: "missing", models: [("coder", "Coder")]),
        ]
        let list = manual(instances, selection: ModelSelection(instanceId: "claude-work", model: "opus"), favorites: ["grok/grok-4", "claude-work/mythos"])
        // Auto is a mode: the list opens on the bot's model, then the favorites as they were starred
        XCTAssertEqual(list.top.map(\.kind), [.follow])
        XCTAssertEqual(list.favorites.map(\.key), ["grok/grok-4", "claude-work/mythos"])
        XCTAssertEqual(list.favorites.last?.account, "ada.admin@acme.test", "a favorite keeps its account")
        XCTAssertEqual(list.providers.map(\.label), ["Claude", "Grok", "Qwen"])
        let claude = list.providers[0]
        XCTAssertTrue(claude.current)
        XCTAssertEqual(claude.accounts.map(\.label), ["ada.admin@acme.test", "ada@example.com", "old@example.com"])
        XCTAssertEqual(claude.accounts.map(\.state), [nil, nil, .signedOut])
        XCTAssertEqual(claude.accounts[0].rows.map(\.modelId), ["mythos", "opus"])
        // the heading names the account: the rows do not say it again, nor the badge
        XCTAssertNil(claude.accounts[0].rows[0].account)
        XCTAssertNil(claude.accounts[0].rows[0].badge)
        XCTAssertTrue(claude.accounts[2].rows.isEmpty, "a signed-out account keeps its heading and its state")
        // a provider's only account that runs needs no heading; one that does not run says so
        XCTAssertNil(list.providers[1].accounts[0].label)
        XCTAssertEqual(list.providers[2].accounts.map(\.state), [.notResponding])
        XCTAssertEqual(list.providers[2].accounts[0].label, "Qwen")
    }

    func testAnOrganizationSignsItsEnginesInItself() {
        let instances = [engine("claude-work", family: "claudeAgent", email: nil, authenticated: false, models: [("opus", "Opus")])]
        let list = manual(instances, selection: ModelSelection(instanceId: "claude-work", model: "opus"), organization: true)
        XCTAssertEqual(list.providers.first?.accounts.map(\.state), [nil])
    }

    func testASearchKeepsTheRowsOfAProviderOrAnAccountItNames() {
        let instances = [
            engine("claude-work", family: "claudeAgent", email: "ada.admin@acme.test", models: [("mythos", "Mythos"), ("opus", "Opus")]),
            engine("claude-home", family: "claudeAgent", email: "ada@example.com", models: [("opus", "Opus")]),
            engine("grok", family: "grok", email: nil, models: [("grok-4", "Grok 4")]),
        ]
        let list = manual(instances, selection: ModelSelection(instanceId: "grok", model: "grok-4"))
        let byAccount = ComposerModes.filter(list, query: "acme")
        XCTAssertEqual(byAccount.providers.map(\.label), ["Claude"])
        XCTAssertEqual(byAccount.providers[0].accounts.map(\.label), ["ada.admin@acme.test"])
        XCTAssertEqual(byAccount.providers[0].accounts[0].rows.map(\.modelId), ["mythos", "opus"])
        let byModel = ComposerModes.filter(list, query: "grok")
        XCTAssertEqual(byModel.providers.map(\.label), ["Grok"])
        XCTAssertEqual(ComposerModes.filter(list, query: "").providers.count, 2)
    }

    func testTheHeavyRowDecodesFromTheToolAndKeepsItsRounds() throws {
        let json = #"""
        {"name":"Team of Experts","ok":true,"team":{"phase":"agents","startedAt":1000,"updatedAt":7000,"maxRounds":5,
         "rounds":[{"n":1,"kind":"propose","startedAt":1000,"endedAt":3000},{"n":2,"kind":"critique","startedAt":3000}],
         "agents":[{"n":1,"persona":"Skeptic","engineLabel":"a","modelLabel":"Opus","status":"working","messages":["p"],"speaking":true},
                   {"n":2,"persona":"Cost","engineLabel":"b","modelLabel":"GPT","status":"working","messages":["q"]},
                   {"n":3,"engineLabel":"c","modelLabel":"Grok","status":"failed","messages":[]}],
         "leader":{"engineLabel":"OpenAI","modelLabel":"GPT","steps":[{"kind":"planned","at":1000}]}}}
        """#
        let tool = try JSONDecoder().decode(ToolActivity.self, from: Data(json.utf8))
        let line = try XCTUnwrap(tool.team)
        XCTAssertEqual(line.agents.map(\.persona), ["Skeptic", "Cost", nil])
        XCTAssertEqual(line.currentRound?.n, 2)
        XCTAssertTrue(line.isRunning(busy: true))
        XCTAssertFalse(line.isRunning(busy: false))
        // a critique round links every two experts still working
        XCTAssertEqual(line.critiqueLinks, [[1, 2]])
        XCTAssertFalse(line.merged)
        XCTAssertEqual(line.thoughtSeconds(now: 7000, running: true), 6)
        // the leader's steps ride the row: the live line reads the last one
        XCTAssertEqual(line.leader.steps, [.init(kind: "planned", at: 1000)])
        XCTAssertEqual(line.leaderNow.kind, "planned")
        // the row goes back out as it came
        XCTAssertEqual(try JSONDecoder().decode(ToolActivity.self, from: JSONEncoder().encode(tool)).team, line)
    }

    func testOnAgreementTheExpertsMergeAndTheyAreEvenlyPlaced() {
        var line = HeavyTeamLine(phase: "leader", startedAt: 0, updatedAt: 0, agents: [], outcome: "agreed", leader: .init(engineLabel: "", modelLabel: ""))
        XCTAssertTrue(line.merged)
        // a row from before the steps: the leader reads as processing
        XCTAssertEqual(line.leaderNow.kind, "processing")
        line.phase = "agents"
        XCTAssertFalse(line.merged)
        let top = HeavyTeamLine.place(0, of: 4, radius: 10)
        XCTAssertEqual(top.x, 0, accuracy: 0.001)
        XCTAssertEqual(top.y, -10, accuracy: 0.001)
        let right = HeavyTeamLine.place(1, of: 4, radius: 10)
        XCTAssertEqual(right.x, 10, accuracy: 0.001)
    }
}
