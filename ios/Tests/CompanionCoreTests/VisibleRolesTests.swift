import Foundation
import XCTest
@testable import CompanionCore

/// Visible roles (2026-11-05, #2016): `tool.role`, `tool.roleNotice` and
/// `card.roleTransition` decode from the wire, and read in the desktop's
/// words (RoleChip.tsx, RoleNoticeRow.tsx, RoleTransitionCard.tsx).
final class VisibleRolesTests: XCTestCase {
    /// The French catalog entries this feature uses, as the app ships them.
    private let french: [String: String] = [
        "roles.me": "Moi",
        "roles.chip.unnamed": "Rôle",
        "roles.chip.idTooltip": "Identifiant du rôle : {id}",
        "roles.chip.meTooltip": "Accès de {person}",
        "roles.why.default": "Par défaut en conversation : votre propre accès, tous vos rôles sauf ceux sur demande seulement.",
        "roles.why.routine": "La routine roule sous ce rôle.",
        "roles.why.switch": "Le bot est passé de {from}.",
        "roles.why.fallback": "{from} a été refusé pour {tool} (403) : cette lecture a roulé une fois au nom de {person}.",
        "roles.notice.lapsed": "Le rôle {role} est échu : l'appel s'est arrêté.",
        "roles.notice.writeRefusedShort": "Écriture refusée sous {role}. {bot} s'est arrêté.",
        "roles.notice.missingLine": "Permission manquante : {permission}",
        "roles.notice.target": "Rôle de sécurité de {member}",
        "roles.op.edit": "Modifier",
        "roles.transition.title": "Agit comme {role}",
        "roles.transition.fallback": "{bot} passe de {from} à {to} : {tool} est refusé (403). Au nom de {person}.",
        "roles.transition.switch": "{bot} passe de {from} à {to}. Au nom de {person}.",
        "roles.transition.continue": "Continuer",
        "roles.transition.stay": "Rester en {role}",
        "roles.transition.always": "Toujours ainsi pour ce bot",
        "roles.transition.answered.stay": "Reste en {role}",
    ]

    private var words: StepWords {
        let catalog = french
        return StepWords(locale: Locale(identifier: "fr-CA")) { catalog[$0] }
    }

    private func message(_ json: String) throws -> Message {
        try JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    func testToolRoleDecodesOnAnActivity() throws {
        let row = try message(#"{"id":"a1","role":"bot","kind":"activity","at":1,"tool":{"name":"mcp__perspicax__cw_psa_find_tickets","ok":true,"role":{"slug":"","name":"","reason":"fallback","refusedTool":"cw_psa_find_tickets","previous":{"slug":"service-desk","name":"Service Desk"},"person":"Alex Martin"}}}"#)
        let role = try XCTUnwrap(row.tool?.role)
        XCTAssertEqual(role.slug, "")
        XCTAssertEqual(role.reason, "fallback")
        XCTAssertEqual(role.previous, RoleRef(slug: "service-desk", name: "Service Desk"))
        XCTAssertEqual(role.person, "Alex Martin")
        XCTAssertTrue(VisibleRoles.changed(role))
        XCTAssertTrue(VisibleRoles.warns(role))
        XCTAssertEqual(VisibleRoles.label(role.ref, words: words), "Moi")
        XCTAssertEqual(VisibleRoles.why(role, words: words), "Service Desk a été refusé pour cw psa find tickets (403) : cette lecture a roulé une fois au nom de Alex Martin.")
        XCTAssertEqual(VisibleRoles.detail(role, words: words), "Accès de Alex Martin")
        // a step with its role is still a step of the run
        XCTAssertTrue(StepGroup.isStep(row))
        XCTAssertTrue(isToolActivityRow(row))
        // the role survives the app's own cache round trip
        let again = try JSONDecoder().decode(Message.self, from: JSONEncoder().encode(row))
        XCTAssertEqual(again.tool?.role, role)
    }

    func testRoleChipWords() throws {
        let same = ToolRole(slug: "service-desk", name: "Service Desk", reason: "routine", previous: RoleRef(slug: "service-desk", name: "Service Desk"))
        XCTAssertFalse(VisibleRoles.changed(same))
        XCTAssertEqual(VisibleRoles.label(same.ref, words: words), "Service Desk")
        XCTAssertEqual(VisibleRoles.why(same, words: words), "La routine roule sous ce rôle.")
        XCTAssertEqual(VisibleRoles.detail(same, words: words), "Identifiant du rôle : service-desk")
        let switched = ToolRole(slug: "full-access", name: "Full Access", reason: "switch", previous: RoleRef(slug: "service-desk", name: "Service Desk"))
        XCTAssertTrue(VisibleRoles.changed(switched))
        XCTAssertEqual(VisibleRoles.why(switched, words: words), "Le bot est passé de Service Desk.")
        // never an id on screen: a GUID name falls back to the slug, then "Rôle"
        let guid = ToolRole(slug: "3f2a1b4c-1111-2222-3333-444455556666", name: "3f2a1b4c-1111-2222-3333-444455556666", reason: "default")
        XCTAssertEqual(VisibleRoles.label(guid.ref, words: words), "Rôle")
        XCTAssertNil(VisibleRoles.detail(guid, words: words))
        XCTAssertEqual(VisibleRoles.why(guid, words: words), french["roles.why.default"])
        // an unknown reason reads as the chat default
        let odd = try JSONDecoder().decode(ToolRole.self, from: Data(#"{"slug":"service-desk","name":"Service Desk","reason":"later"}"#.utf8))
        XCTAssertEqual(VisibleRoles.why(odd, words: words), french["roles.why.default"])
    }

    func testRoleNoticeDecodesAsABannerRow() throws {
        let row = try message(#"{"id":"n1","role":"bot","kind":"activity","at":2,"tool":{"name":"Write refused as Service Desk","ok":false,"roleNotice":{"kind":"write_refused","role":{"slug":"service-desk","name":"Service Desk"},"tool":"cw_psa_update_ticket","permission":{"path":"service/tickets","module":"Service Desk","func":"Service Tickets","operation":"Edit"},"person":"Alex Martin","target":"cw_member:amartin"}}}"#)
        let notice = try XCTUnwrap(row.tool?.roleNotice)
        XCTAssertEqual(notice.kind, .writeRefused)
        XCTAssertEqual(notice.permission, CwPermission(path: "service/tickets", module: "Service Desk", function: "Service Tickets", operation: "Edit"))
        XCTAssertEqual(notice.member, "amartin")
        XCTAssertEqual(VisibleRoles.noticeText(notice, botName: "Nova", words: words), "Écriture refusée sous Service Desk. Nova s'est arrêté.")
        XCTAssertEqual(VisibleRoles.missingLine(notice, words: words), "Permission manquante : Service Desk › Service Tickets (service/tickets) · Modifier · Rôle de sécurité de amartin")
        // a banner is a row of its own, never folded into a run of steps
        XCTAssertFalse(StepGroup.isStep(row))
        XCTAssertFalse(isToolActivityRow(row))
        let rows = transcriptRows([row], detail: .full)
        guard case .message(let only)? = rows.first, rows.count == 1 else { return XCTFail("one message row: \(rows)") }
        XCTAssertEqual(only.id, "n1")

        let lapsed = try JSONDecoder().decode(RoleNotice.self, from: Data(#"{"kind":"lapsed","role":{"slug":"full-access","name":"Full Access"},"tool":"cw_psa_query"}"#.utf8))
        XCTAssertEqual(VisibleRoles.noticeText(lapsed, botName: nil, words: words), "Le rôle Full Access est échu : l'appel s'est arrêté.")
        XCTAssertNil(VisibleRoles.missingLine(lapsed, words: words))
        // an unknown kind drops the notice, not the row
        let odd = try message(#"{"id":"n2","role":"bot","kind":"activity","at":3,"tool":{"name":"x","roleNotice":{"kind":"later","role":{"slug":"a","name":"A"},"tool":"t"}}}"#)
        XCTAssertNil(odd.tool?.roleNotice)
        XCTAssertEqual(odd.tool?.name, "x")
    }

    func testRoleTransitionCardDecodesAndReads() throws {
        let row = try message(#"{"id":"c1","role":"bot","kind":"options","at":4,"card":{"title":"Agit comme Moi","subtitle":"…","options":["Continuer","Rester en Service Desk","Toujours ainsi pour ce bot"],"roleTransition":{"botId":"b1","botName":"Nova","person":"Alex Martin","from":{"slug":"service-desk","name":"Service Desk"},"to":{"slug":"","name":""},"reason":"fallback","refusedTool":"cw_psa_find_tickets","path":"service/tickets","canAlways":true}}}"#)
        let card = try XCTUnwrap(row.card)
        let transition = try XCTUnwrap(card.roleTransition)
        XCTAssertEqual(transition.botId, "b1")
        XCTAssertEqual(transition.canAlways, true)
        XCTAssertNil(transition.choice)
        XCTAssertNil(VisibleRoles.settledChoice(card))
        // not the first-run quiz, which leaves once talked past
        XCTAssertFalse(OptionCardRules.isOnboardingCard(row))
        XCTAssertEqual(VisibleRoles.transitionTitle(transition, words: words), "Agit comme Moi")
        XCTAssertEqual(VisibleRoles.transitionText(transition, words: words), "Nova passe de Service Desk à Moi : « service/tickets » est refusé (403). Au nom de Alex Martin.")
        XCTAssertEqual(VisibleRoles.choices(transition, words: words).map(\.label), ["Continuer", "Rester en Service Desk", "Toujours ainsi pour ce bot"])
        XCTAssertEqual(VisibleRoles.choices(transition, words: words).map(\.choice), [.continue, .stay, .always])

        var member = transition
        member.canAlways = false
        XCTAssertEqual(VisibleRoles.choices(member, words: words).map(\.choice), [.continue, .stay])
        member.reason = "switch"
        XCTAssertEqual(VisibleRoles.transitionText(member, words: words), "Nova passe de Service Desk à Moi. Au nom de Alex Martin.")

        let settled = try message(#"{"id":"c2","role":"bot","kind":"options","at":5,"card":{"title":"T","subtitle":"","options":["Continuer","Rester en Service Desk"],"answered":"Rester en Service Desk","roleTransition":{"botId":"b1","botName":"Nova","person":"Alex Martin","from":{"slug":"service-desk","name":"Service Desk"},"to":{"slug":"full-access","name":"Full Access"},"reason":"switch","choice":"stay"}}}"#)
        let settledCard = try XCTUnwrap(settled.card)
        XCTAssertEqual(VisibleRoles.settledChoice(settledCard), .stay)
        XCTAssertEqual(VisibleRoles.answeredText(.stay, card: try XCTUnwrap(settledCard.roleTransition), words: words), "Reste en Service Desk")
        // an older patch with only `answered` still reads its choice
        var marked = settledCard
        marked.roleTransition?.choice = nil
        XCTAssertEqual(VisibleRoles.settledChoice(marked), .stay)
    }

    func testStepsUnderDifferentRolesAreNotMerged() throws {
        let a = try message(#"{"id":"s1","role":"bot","kind":"activity","at":1,"tool":{"name":"cw_psa_query","ok":true,"role":{"slug":"service-desk","name":"Service Desk","reason":"default"}}}"#)
        let b = try message(#"{"id":"s2","role":"bot","kind":"activity","at":2,"tool":{"name":"cw_psa_query","ok":true,"role":{"slug":"full-access","name":"Full Access","reason":"switch","previous":{"slug":"service-desk","name":"Service Desk"}}}}"#)
        let c = try message(#"{"id":"s3","role":"bot","kind":"activity","at":3,"tool":{"name":"cw_psa_query","ok":true,"role":{"slug":"full-access","name":"Full Access","reason":"switch","previous":{"slug":"service-desk","name":"Service Desk"}}}}"#)
        let entries = StepGroup.merge([a, b, c], words: words)
        XCTAssertEqual(entries.count, 2)
        guard case let .steps(_, merged, _, _, _, _) = entries[1] else { return XCTFail("steps") }
        XCTAssertEqual(merged.map(\.id), ["s2", "s3"])
    }
}
