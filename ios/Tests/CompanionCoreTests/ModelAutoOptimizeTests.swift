// #2106: Auto's Optimize for Intelligence / Balance / Cost on the model menu.
import Foundation
import XCTest
@testable import CompanionCore

final class ModelAutoOptimizeTests: XCTestCase {
    func testAbsentMeansBalance() {
        XCTAssertEqual(ModelAutoOptimize.of(nil), .balance)
        XCTAssertEqual(ModelAutoOptimize.of("nope"), .balance)
        XCTAssertEqual(ModelAutoOptimize.of("intelligence"), .intelligence)
        XCTAssertEqual(ModelAutoOptimize.of("cost"), .cost)
        XCTAssertEqual(ModelAutoOptimize.allCases.map(\.rawValue), ["intelligence", "balance", "cost"])
    }

    func testSelectionRoundTripsAutoOptimize() throws {
        let selection = ModelSelection(instanceId: "claude", model: "opus", auto: true, autoOptimize: .intelligence)
        XCTAssertEqual(selection.autoOptimize, .intelligence)
        let data = try JSONEncoder().encode(selection)
        let decoded = try JSONDecoder().decode(ModelSelection.self, from: data)
        XCTAssertEqual(decoded.auto, true)
        XCTAssertEqual(decoded.autoOptimize, .intelligence)
        let plain = try JSONDecoder().decode(ModelSelection.self, from: Data(#"{"instanceId":"claude","model":"opus"}"#.utf8))
        XCTAssertNil(plain.autoOptimize)
        XCTAssertEqual(plain.autoOptimize ?? .balance, .balance)
    }

    func testPinningAModelDropsAutoAndOptimize() throws {
        let current = ModelSelection(instanceId: "claude", model: "opus", auto: true, autoOptimize: .cost)
        let instance = try JSONDecoder().decode(Instance.self, from: Data("""
        {"instanceId":"claude","driverKind":"claudeAgent","snapshot":{"state":"available","authenticated":true},
         "models":{"default":"opus","options":[{"id":"sonnet","label":"Sonnet"},{"id":"opus","label":"Opus"}]}}
        """.utf8))
        let next = ModelPickerRules.selectionForPick(current, instance: instance, model: "sonnet")
        XCTAssertNil(next.auto)
        XCTAssertNil(next.autoOptimize)
        XCTAssertEqual(next.model, "sonnet")
    }

    /// #4900: a composer mode chosen on the desktop is not lost when this phone
    /// sends the selection back (an effort change, say).
    func testSelectionKeepsTheComposerMode() throws {
        let decoded = try JSONDecoder().decode(ModelSelection.self, from: Data(#"{"instanceId":"claude","model":"opus","auto":true,"mode":"heavy"}"#.utf8))
        XCTAssertEqual(decoded.mode, "heavy")
        let data = try JSONEncoder().encode(decoded)
        XCTAssertEqual(try JSONDecoder().decode(ModelSelection.self, from: data).mode, "heavy")
        let plain = try JSONDecoder().decode(ModelSelection.self, from: Data(#"{"instanceId":"claude","model":"opus"}"#.utf8))
        XCTAssertNil(plain.mode)
    }

    func testPinningAModelDropsTheMode() throws {
        let current = ModelSelection(instanceId: "claude", model: "opus", auto: true, mode: "expert")
        let instance = try JSONDecoder().decode(Instance.self, from: Data("""
        {"instanceId":"claude","driverKind":"claudeAgent","snapshot":{"state":"available","authenticated":true},
         "models":{"default":"opus","options":[{"id":"sonnet","label":"Sonnet"},{"id":"opus","label":"Opus"}]}}
        """.utf8))
        XCTAssertNil(ModelPickerRules.selectionForPick(current, instance: instance, model: "sonnet").mode)
    }
}
