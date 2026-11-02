import XCTest
@testable import CompanionCore

final class VaultClientTests: XCTestCase {
    func testACardListingShowsTheLastFourAndNotANumber() throws {
        let json = """
        {"items":[{"id":"abc12345","kind":"card","name":"Shop","domains":[],"hasPassword":false,"hasNotes":false,"card":{"brand":"visa","last4":"4242","expMonth":12,"expYear":2030,"holder":"Ada"}}],"purchases":[{"id":"pay_0123456789abcdef","title":"Pay 12.50 CAD to Shop?","line":"Card ending 4242 (visa).","merchant":"Shop"}]}
        """
        let list = try JSONDecoder().decode(VaultList.self, from: Data(json.utf8))
        XCTAssertEqual(list.items[0].subtitle, "visa · 4242")
        XCTAssertFalse(json.contains("4242424242424242"))
        XCTAssertEqual(list.purchases[0].merchant, "Shop")
        XCTAssertTrue(list.history.isEmpty)
        XCTAssertTrue(list.methods.isEmpty)
        XCTAssertNil(list.payments)
    }

    func testAnOlderListWithoutPurchasesStillDecodes() throws {
        let json = """
        {"items":[{"id":"abc12345","kind":"login","name":"Portal","domains":["example.test"],"hasPassword":true,"hasNotes":false}]}
        """
        let list = try JSONDecoder().decode(VaultList.self, from: Data(json.utf8))
        XCTAssertTrue(list.purchases.isEmpty)
        XCTAssertTrue(list.history.isEmpty)
        XCTAssertTrue(list.methods.isEmpty)
        XCTAssertEqual(list.items[0].subtitle, "example.test")
    }

    func testListDecodesPaymentsMethodsAndHistory() throws {
        let json = """
        {
          "items":[{"id":"abcd1234","kind":"card","name":"Travel","domains":[],"hasPassword":false,"hasNotes":false,"card":{"brand":"visa","last4":"4242","expMonth":1,"expYear":2031,"holder":"Ada"}}],
          "purchases":[{"id":"pay_aaaaaaaaaaaaaaaa","title":"Pay 9.00 CAD to Shop?","line":"Travel ···· 4242.","merchant":"Shop","amount":"9.00","currency":"CAD","status":"pending","cardName":"Travel","cardLast4":"4242","createdAt":1730000000000}],
          "history":[{"id":"pay_bbbbbbbbbbbbbbbb","title":"Pay 20.00 CAD to Books?","line":"Done.","merchant":"Books","amount":"20.00","currency":"CAD","status":"done","cardName":"Travel","cardLast4":"4242","orderRef":"ORD-9","doneAt":1730001000000,"createdAt":1730000500000}],
          "payments":{"defaultMethod":{"type":"card","cardId":"abcd1234"},"bots":{"bot-ada":{"enabled":true,"perPurchaseLimit":"50.00","merchants":["shop.example.test"]},"bot-off":{"enabled":false}}},
          "methods":[
            {"id":"card:abcd1234","type":"card","label":"Travel","detail":"visa ···· 4242","brand":"visa","last4":"4242","isDefault":true},
            {"id":"wallet:shop_pay","type":"wallet","label":"Shop Pay","detail":"Connected","brand":"wallet","wallet":"shop_pay","isDefault":false,"ready":true}
          ],
          "wallets":{"shop_pay":{"chosen":true,"ready":true,"missing":""},"link":{"chosen":false,"ready":false,"missing":"no session"}}
        }
        """
        let list = try JSONDecoder().decode(VaultList.self, from: Data(json.utf8))
        XCTAssertEqual(list.purchases[0].amount, "9.00")
        XCTAssertEqual(list.purchases[0].currency, "CAD")
        XCTAssertEqual(list.purchases[0].status, "pending")
        XCTAssertEqual(list.purchases[0].cardLast4, "4242")
        XCTAssertEqual(list.history.count, 1)
        XCTAssertEqual(list.history[0].orderRef, "ORD-9")
        XCTAssertEqual(list.history[0].doneAt, 1730001000000)
        XCTAssertEqual(list.payments?.defaultMethod?.cardId, "abcd1234")
        XCTAssertEqual(list.payments?.allowance(for: "bot-ada").perPurchaseLimit, "50.00")
        XCTAssertTrue(list.payments?.allowance(for: "bot-ada").mayPay == true)
        XCTAssertFalse(list.payments?.allowance(for: "bot-off").mayPay == true)
        XCTAssertTrue(list.payments?.allowance(for: "bot-missing").mayPay == true)
        XCTAssertEqual(list.methods.count, 2)
        XCTAssertEqual(list.methods[0].last4, "4242")
        XCTAssertEqual(list.methods[1].wallet, "shop_pay")
        XCTAssertFalse(json.contains("4111111111111111"))
    }

    func testPatchPaymentsEncodesDefaultClearAndBotNull() throws {
        let patch = PaymentsSettingsPatch(
            defaultMethod: .some(nil),
            bots: [
                "bot-a": BotPaymentAllowancePublic(enabled: true, perPurchaseLimit: "10.00"),
                "bot-b": nil,
            ]
        )
        let data = try JSONEncoder().encode(patch)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertTrue(object["defaultMethod"] is NSNull)
        let bots = try XCTUnwrap(object["bots"] as? [String: Any])
        XCTAssertTrue(bots["bot-b"] is NSNull)
        let botA = try XCTUnwrap(bots["bot-a"] as? [String: Any])
        XCTAssertEqual(botA["enabled"] as? Bool, true)
        XCTAssertEqual(botA["perPurchaseLimit"] as? String, "10.00")
    }

    func testPatchPaymentsEncodesCardAndWalletDefaults() throws {
        let card = try JSONEncoder().encode(PaymentsSettingsPatch(defaultMethod: .some(.card("abcd1234"))))
        let cardObject = try XCTUnwrap(JSONSerialization.jsonObject(with: card) as? [String: Any])
        let cardMethod = try XCTUnwrap(cardObject["defaultMethod"] as? [String: Any])
        XCTAssertEqual(cardMethod["type"] as? String, "card")
        XCTAssertEqual(cardMethod["cardId"] as? String, "abcd1234")
        XCTAssertNil(cardMethod["wallet"])

        let wallet = try JSONEncoder().encode(PaymentsSettingsPatch(defaultMethod: .some(.wallet("link"))))
        let walletObject = try XCTUnwrap(JSONSerialization.jsonObject(with: wallet) as? [String: Any])
        let walletMethod = try XCTUnwrap(walletObject["defaultMethod"] as? [String: Any])
        XCTAssertEqual(walletMethod["type"] as? String, "wallet")
        XCTAssertEqual(walletMethod["wallet"] as? String, "link")
        XCTAssertNil(walletObject["bots"])
    }

    func testMayPayDefaultsOnWhenEnabledAbsent() {
        XCTAssertTrue(BotPaymentAllowancePublic().mayPay)
        XCTAssertTrue(BotPaymentAllowancePublic(enabled: true).mayPay)
        XCTAssertFalse(BotPaymentAllowancePublic(enabled: false).mayPay)
    }
}
