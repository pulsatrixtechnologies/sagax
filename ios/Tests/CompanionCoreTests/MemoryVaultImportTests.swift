// Mirrors shared/obsidian-import.test.ts and src/lib/memory-import.test.ts.
import Compression
import Foundation
import XCTest
@testable import CompanionCore

private func fixtureVault() -> [VaultFile] {
    func note(_ path: String, _ text: String) -> VaultFile { VaultFile(path: path, size: text.utf8.count, text: text) }
    let leaked = "The deploy key is " + "sk-ant-" + "api03-" + String(repeating: "a", count: 28) + " do not share."
    return [
        VaultFile(path: "Field Notes/.env", size: 14),
        VaultFile(path: "Field Notes/.obsidian/app.json", size: 21),
        note("Field Notes/.trash/Old.md", "deleted note\n"),
        note("Field Notes/Existing.md", "A note whose name is already in the destination.\n"),
        note("Field Notes/People/Jane Doe.md", "Jane leads [[Alpha plan#Owners]]. #person\n"),
        note("Field Notes/Projects/Alpha/Alpha plan.md", "---\naliases:\n  - Alpha\ntags:\n  - project/alpha\nstatus: active\n---\nThe plan for Alpha. Owner: [[People/Jane Doe]].\n\n![[diagram.png]]\n\nSee [[Missing note]] later. #roadmap\n"),
        note("Field Notes/Welcome.md", "---\ntitle: Welcome\ntags: [inbox, start]\ncreated: 2026-10-01\n---\n# Welcome\n\nStart at [[Alpha plan]] and meet [[Jane Doe|Jane]]. #getting-started\n\n```bash\n# not a tag, and [[not a link]]\n```\n"),
        VaultFile(path: "Field Notes/assets/diagram.png", size: 15),
        note("Field Notes/Leaked key.md", leaked),
    ].sorted { $0.path < $1.path }
}

private func vault() -> (root: String, files: [VaultFile]) {
    let files = fixtureVault()
    let (root, paths) = ObsidianVault.stripRoot(files.map(\.path))
    return (root, zip(files, paths).map { VaultFile(path: $1, size: $0.size, text: $0.text) })
}

final class MemoryVaultImportTests: XCTestCase {
    // MARK: paths

    func testRefusesAPathThatCouldLeaveTheVault() {
        for bad in ["../x.md", "a/../../x.md", "/etc/passwd", "C:/x.md", "a\\b.md", "a//b.md", "a/./b.md", "a\u{0}.md", ""] {
            XCTAssertNil(ObsidianVault.safePath(bad), bad)
        }
        XCTAssertEqual(ObsidianVault.safePath("./Projects/Alpha plan.md"), "Projects/Alpha plan.md")
    }

    func testFindsTheVaultsOwnTopFolder() {
        let a = ObsidianVault.stripRoot(["V/a.md", "V/b/c.md"])
        XCTAssertEqual(a.root, "V")
        XCTAssertEqual(a.paths, ["a.md", "b/c.md"])
        XCTAssertEqual(ObsidianVault.stripRoot(["a.md", "b/c.md"]).root, "")
    }

    func testChecksThePathsTheServerWrites() {
        XCTAssertTrue(ObsidianVault.botImportNotePath("memory/Field Notes - Welcome.md"))
        XCTAssertFalse(ObsidianVault.botImportNotePath("memory/../SOUL.md"))
        XCTAssertFalse(ObsidianVault.botImportNotePath("memory/a/b.md"))
        XCTAssertTrue(ObsidianVault.botImportAttachmentPath("memory-attachments/Field-Notes/assets/diagram.png"))
        XCTAssertFalse(ObsidianVault.botImportAttachmentPath("memory-attachments/../SOUL.md"))
        XCTAssertFalse(ObsidianVault.botImportAttachmentPath("memory-attachments/x/run.sh"))
        XCTAssertFalse(ObsidianVault.botImportAttachmentPath("docs/diagram.png"))
    }

    // MARK: markdown

    func testReadsFrontMatter() {
        let front = ObsidianVault.parseFrontMatter("---\ntitle: \"Hello\"\ntags: [a, b]\naliases:\n  - One\n  - Two\n---\nBody\n")
        XCTAssertEqual(front.data, ["title": .text("Hello"), "tags": .list(["a", "b"]), "aliases": .list(["One", "Two"])])
        XCTAssertEqual(front.body, "Body\n")
        XCTAssertNil(ObsidianVault.parseFrontMatter("No header").raw)
    }

    func testFindsTagsOutsideCodeNotHeadingsOrNumbers() {
        XCTAssertEqual(ObsidianVault.inlineTags("# Heading\nText #one and #two/three, #2026 `#code`\n```\n#fenced\n```\n"), ["one", "two/three"])
    }

    func testMakesPerspicaxTopicsAndTags() {
        XCTAssertEqual(ObsidianVault.topicSlug("Field Notes / Été"), "field-notes-ete")
        XCTAssertEqual(ObsidianVault.topicSlug("Inbox"), "inbox-notes")
        XCTAssertEqual(ObsidianVault.topicSlug(String(repeating: "x", count: 80)).count, 48)
        XCTAssertEqual(ObsidianVault.pxTag("Project/Alpha"), "project/alpha")
        XCTAssertNil(ObsidianVault.pxTag("###"))
    }

    func testCutsALongBodyUnderThePerspicaxLimit() {
        let body = (0..<20).map { "Paragraph \($0) " + String(repeating: "word ", count: 80) }.joined(separator: "\n\n")
        let parts = ObsidianVault.pieces(body)
        XCTAssertGreaterThan(parts.count, 1)
        for part in parts { XCTAssertLessThanOrEqual(part.utf8.count, 3800) }
    }

    func testSeesTheSecretShapes() {
        XCTAssertTrue(ObsidianVault.textHoldsSecret("key " + "ghp_" + String(repeating: "a", count: 36)))
        XCTAssertTrue(ObsidianVault.textHoldsSecret("Server=sql1;User Id=sa;Password=Hunter22;"))
        XCTAssertTrue(ObsidianVault.textHoldsSecret("postgres://admin:s3cret@db.local/app"))
        XCTAssertFalse(ObsidianVault.textHoldsSecret("The password is in the vault, see the onboarding procedure."))
        XCTAssertTrue(ObsidianVault.isSecretFile(".env"))
        XCTAssertTrue(ObsidianVault.isSecretFile("keys/id_rsa"))
        XCTAssertFalse(ObsidianVault.isSecretFile("Welcome.md"))
    }

    // MARK: the plan

    func testPlansTheFixtureVaultIntoAPerspicaxTier() {
        let (root, files) = vault()
        XCTAssertEqual(root, "Field Notes")
        let plan = ObsidianVault.plan(VaultPlanInput(
            vaultName: root, files: files, destination: .perspicax, folder: root,
            existing: [VaultExistingNote(folder: "field-notes", title: "Existing", body: "something else", id: "ex1")]
        ))
        let byTitle = Dictionary(uniqueKeysWithValues: plan.notes.map { ($0.title, $0) })
        XCTAssertEqual(Array(byTitle.keys).sorted(), ["Alpha plan", "Existing", "Jane Doe", "Welcome"])
        // nested folders become topics under the vault's own
        XCTAssertEqual(byTitle["Alpha plan"]?.folder, "field-notes-projects-alpha")
        XCTAssertEqual(byTitle["Jane Doe"]?.folder, "field-notes-people")
        XCTAssertEqual(byTitle["Welcome"]?.folder, "field-notes")
        // links point at the imported titles; code and unknown targets stay as they are
        XCTAssertTrue(byTitle["Welcome"]!.body.contains("[[Alpha plan]]"))
        XCTAssertTrue(byTitle["Welcome"]!.body.contains("[[Jane Doe|Jane]]"))
        XCTAssertTrue(byTitle["Welcome"]!.body.contains("[[not a link]]"))
        XCTAssertTrue(byTitle["Alpha plan"]!.body.contains("[[Jane Doe|People/Jane Doe]]"))
        XCTAssertTrue(byTitle["Alpha plan"]!.body.contains("[[Missing note]]"))
        XCTAssertTrue(byTitle["Jane Doe"]!.body.contains("[[Alpha plan#Owners]]"))
        // tags from the front matter and the text
        XCTAssertEqual(byTitle["Welcome"]?.tags, ["inbox", "start", "getting-started"])
        XCTAssertEqual(byTitle["Alpha plan"]?.tags, ["project/alpha", "roadmap"])
        // properties kept as the note's front matter
        XCTAssertTrue(byTitle["Alpha plan"]!.body.hasPrefix("---\naliases:"))
        XCTAssertTrue(byTitle["Alpha plan"]!.body.contains("status: active"))
        // the conflict is skipped by default
        XCTAssertEqual(byTitle["Existing"]?.action, .skip)
        XCTAssertEqual(byTitle["Existing"]?.conflict, true)
        // Perspicax keeps no attachment: the image is reported
        XCTAssertEqual(plan.attachments, [])
        for entry in [
            VaultSkipped(path: ".obsidian/app.json", reason: .system),
            VaultSkipped(path: ".trash/Old.md", reason: .system),
            VaultSkipped(path: ".env", reason: .secret),
            VaultSkipped(path: "Leaked key.md", reason: .secret),
            VaultSkipped(path: "assets/diagram.png", reason: .attachmentUnsupported),
        ] { XCTAssertTrue(plan.skipped.contains(entry), "\(entry)") }
        XCTAssertEqual(plan.counts.notes, 3)
        XCTAssertEqual(plan.counts.conflicts, 1)
        XCTAssertEqual(plan.counts.secrets, 2)
        XCTAssertEqual(plan.counts.attachments, 0)
        XCTAssertEqual(plan.counts.tags, 6)
        XCTAssertEqual(plan.counts.links, 4)
        // nothing of the key reaches the plan
        XCTAssertFalse(String(describing: plan).contains("api03"))
    }

    func testRenamesOrOverwritesAConflictAndSeesAnUnchangedNote() {
        let (root, files) = vault()
        func input(_ conflict: VaultConflict, _ existing: [VaultExistingNote]) -> VaultPlanInput {
            var options = VaultImportOptions.default
            options.conflict = conflict
            return VaultPlanInput(vaultName: root, files: files, options: options, destination: .perspicax, folder: root, existing: existing)
        }
        let renamed = ObsidianVault.plan(input(.rename, [VaultExistingNote(folder: "field-notes", title: "Existing")]))
        let renamedNote = renamed.notes.first { $0.source == "Existing.md" }
        XCTAssertEqual(renamedNote?.title, "Existing (2)")
        XCTAssertEqual(renamedNote?.action, .rename)
        let over = ObsidianVault.plan(input(.overwrite, [VaultExistingNote(folder: "field-notes", title: "Existing", id: "ex1")]))
        let overNote = over.notes.first { $0.source == "Existing.md" }
        XCTAssertEqual(overNote?.title, "Existing")
        XCTAssertEqual(overNote?.action, .overwrite)
        XCTAssertEqual(overNote?.existingId, "ex1")
        let first = ObsidianVault.plan(input(.skip, []))
        // a second run over what the first wrote writes nothing
        let again = ObsidianVault.plan(input(.rename, first.notes.map { VaultExistingNote(folder: $0.folder, title: $0.title, body: $0.body) }))
        XCTAssertEqual(again.counts.notes, 0)
        XCTAssertEqual(again.counts.unchanged, first.notes.count)
    }

    func testPlansABotsFlatMemoryWithItsAttachments() {
        let (root, files) = vault()
        let plan = ObsidianVault.plan(VaultPlanInput(vaultName: root, files: files, destination: .bot, folder: root))
        let paths = plan.notes.compactMap(\.path).sorted()
        XCTAssertEqual(paths, [
            "memory/Field Notes - Existing.md",
            "memory/Field Notes - People - Jane Doe.md",
            "memory/Field Notes - Projects - Alpha - Alpha plan.md",
            "memory/Field Notes - Welcome.md",
        ])
        for path in paths { XCTAssertTrue(ObsidianVault.botImportNotePath(path), path) }
        let alpha = plan.notes.first { $0.source == "Projects/Alpha/Alpha plan.md" }!
        XCTAssertTrue(alpha.body.contains("![diagram.png](memory-attachments/Field-Notes/assets/diagram.png)"))
        XCTAssertTrue(alpha.body.contains("[[Field Notes - People - Jane Doe|People/Jane Doe]]"))
        XCTAssertTrue(alpha.body.contains("tags: [project/alpha, roadmap]"))
        XCTAssertEqual(plan.attachments, [VaultPlannedAttachment(source: "assets/diagram.png", target: "memory-attachments/Field-Notes/assets/diagram.png", size: 15)])
        for attachment in plan.attachments { XCTAssertTrue(ObsidianVault.botImportAttachmentPath(attachment.target)) }
    }

    func testKeepsTheOptionsOffWhenAsked() {
        let (root, files) = vault()
        var options = VaultImportOptions.default
        options.keepStructure = false
        options.wikilinks = false
        options.tags = false
        options.properties = false
        options.attachments = false
        options.skipSystem = false
        let plan = ObsidianVault.plan(VaultPlanInput(vaultName: root, files: files, options: options, destination: .perspicax, folder: root))
        let alpha = plan.notes.first { $0.source == "Projects/Alpha/Alpha plan.md" }!
        XCTAssertEqual(alpha.folder, "field-notes")
        XCTAssertTrue(alpha.body.contains("[[People/Jane Doe]]"))
        XCTAssertTrue(alpha.body.contains("![[diagram.png]]"))
        XCTAssertFalse(alpha.body.hasPrefix("---"))
        XCTAssertEqual(alpha.tags, [])
        // .trash is read when asked; .obsidian holds no note
        XCTAssertTrue(plan.notes.contains { $0.source == ".trash/Old.md" })
        XCTAssertTrue(plan.skipped.contains(VaultSkipped(path: ".obsidian/app.json", reason: .unsupported)))
    }

    func testRefusesUnsafeOversizedAndUnsupportedFiles() {
        let plan = ObsidianVault.plan(VaultPlanInput(vaultName: "v", files: [
            VaultFile(path: "../escape.md", size: 3, text: "abc"),
            VaultFile(path: "big.md", size: 2_000_000, text: "x"),
            VaultFile(path: "script.sh", size: 3),
            VaultFile(path: "keys/id_rsa", size: 3),
        ], destination: .bot, folder: "v"))
        XCTAssertEqual(plan.notes, [])
        XCTAssertEqual(plan.skipped.map(\.reason), [.unsafePath, .tooLarge, .unsupported, .secret])
    }

    // MARK: a vault's .zip

    private func le(_ value: Int, _ bytes: Int) -> [UInt8] { (0..<bytes).map { UInt8((value >> (8 * $0)) & 0xff) } }

    private func deflate(_ data: Data) -> Data {
        let capacity = data.count + 1024
        var out = Data(count: capacity)
        let n = out.withUnsafeMutableBytes { dst in
            data.withUnsafeBytes { src in
                compression_encode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, capacity, src.bindMemory(to: UInt8.self).baseAddress!, data.count, nil, COMPRESSION_ZLIB)
            }
        }
        return out.prefix(n)
    }

    /// A zip as an archiver writes one: each entry deflated (or stored), then the central directory.
    private func zip(_ files: [(name: String, data: Data, store: Bool, flags: Int)]) -> Data {
        var locals = Data()
        var centrals = Data()
        for file in files {
            let name = Data(file.name.utf8)
            let body = file.store ? file.data : deflate(file.data)
            let method = file.store ? 0 : 8
            var local = Data(le(0x04034b50, 4) + le(20, 2) + le(file.flags, 2) + le(method, 2) + le(0, 4) + le(0, 4))
            local += Data(le(body.count, 4) + le(file.data.count, 4) + le(name.count, 2) + le(0, 2))
            let offset = locals.count
            locals += local + name + body
            var central = Data(le(0x02014b50, 4) + le(20, 2) + le(20, 2) + le(file.flags, 2) + le(method, 2) + le(0, 4) + le(0, 4))
            central += Data(le(body.count, 4) + le(file.data.count, 4) + le(name.count, 2) + le(0, 2) + le(0, 2) + le(0, 2) + le(0, 2) + le(0, 4) + le(offset, 4))
            centrals += central + name
        }
        var end = Data(le(0x06054b50, 4) + le(0, 2) + le(0, 2) + le(files.count, 2) + le(files.count, 2))
        end += Data(le(centrals.count, 4) + le(locals.count, 4) + le(0, 2))
        return locals + centrals + end
    }

    private func entry(_ name: String, _ text: String, store: Bool = false, flags: Int = 0) -> (name: String, data: Data, store: Bool, flags: Int) {
        (name, Data(text.utf8), store, flags)
    }

    func testReadsAZipsNotesAndKeepsAnImageForLater() throws {
        let archive = zip([
            entry("My Vault/", "", store: true),
            entry("My Vault/Home.md", "Hello [[Other]] #tag\n"),
            entry("My Vault/Other.md", "Other note\n"),
            entry("My Vault/img.png", "png-bytes", store: true),
            entry("My Vault/.env", "TOKEN=x"),
        ])
        let source = try VaultSource.readZip(archive, name: "My Vault.zip")
        XCTAssertEqual(source.name, "My Vault")
        XCTAssertEqual(source.files.map(\.path), ["Home.md", "Other.md", "img.png", ".env"])
        XCTAssertEqual(source.files.map(\.text), ["Hello [[Other]] #tag\n", "Other note\n", nil, nil])
        XCTAssertEqual(String(decoding: try source.bytes("img.png"), as: UTF8.self), "png-bytes")
        // a secret-looking file is never opened
        XCTAssertThrowsError(try source.bytes(".env"))
    }

    func testRefusesAnEncryptedZipOneWithTooManyFilesAndNotAZip() {
        XCTAssertThrowsError(try VaultZip.entries(zip([entry("a.md", "x", flags: 1)]), maxEntries: 10, maxEntryBytes: 100)) {
            XCTAssertEqual($0 as? VaultReadError, .encrypted)
        }
        XCTAssertThrowsError(try VaultZip.entries(zip([entry("a.md", "x"), entry("b.md", "y")]), maxEntries: 1, maxEntryBytes: 100)) {
            XCTAssertEqual($0 as? VaultReadError, .tooManyFiles(1))
        }
        XCTAssertThrowsError(try VaultZip.entries(Data(count: 10), maxEntries: 1, maxEntryBytes: 1)) {
            XCTAssertEqual($0 as? VaultReadError, .notAZip)
        }
    }

    // MARK: the runner

    private func source(_ files: [String: String]) -> VaultSource {
        VaultSource(name: "Vault", files: files.sorted { $0.key < $1.key }.map { VaultFile(path: $0.key, size: $0.value.utf8.count, text: $0.value) }) { _ in Data([1, 2, 3]) }
    }

    private final class Writers: VaultImportWriters {
        var calls: [String] = []
        var attachments: [(path: String, data: String)] = []
        var onCall: (() -> Void)?

        func bot(botId: String, notes: [(path: String, text: String)], attachments: [(path: String, data: String)], conflict: VaultConflict) async throws -> [VaultWriteResult] {
            calls.append("bot:\(notes.count)+\(attachments.count)")
            self.attachments += attachments
            return (notes.map(\.path) + attachments.map(\.path)).map { VaultWriteResult(path: $0, status: .written) }
        }

        func pxCreate(scope: String, topic: String, title: String, body: String, tags: [String]) async throws {
            calls.append("create:\(topic)/\(title)")
            onCall?()
            if title == "Bad" { throw VaultReadError.notInVault("refused: secret") }
        }

        func pxUpdate(scope: String, id: String, title: String, body: String, tags: [String]) async throws {
            calls.append("update:\(id)")
        }
    }

    func testWritesAPerspicaxTierNoteByNoteAndStopsWhenAsked() async {
        let vault = source(["A.md": "a", "B.md": "b", "Bad.md": "c", "Old.md": "new text"])
        var options = VaultImportOptions.default
        options.conflict = .overwrite
        let plan = ObsidianVault.plan(VaultPlanInput(vaultName: "Vault", files: vault.files, options: options, destination: .perspicax, folder: "Vault", existing: [VaultExistingNote(folder: "vault", title: "Old", body: "old", id: "o1")]))
        let w = Writers()
        let done = await VaultImportRunner.run(plan: plan, source: vault, target: .perspicax(scope: "me"), conflict: .overwrite, writers: w)
        XCTAssertEqual(w.calls, ["create:vault/A", "create:vault/B", "create:vault/Bad", "update:o1"])
        XCTAssertEqual(done.outcomes.filter { $0.status == .refused }.map(\.title), ["Bad"])
        XCTAssertEqual(done.done, 4)

        let w2 = Writers()
        var stop = false
        w2.onCall = { stop = true }
        let stopped = await VaultImportRunner.run(plan: plan, source: vault, target: .perspicax(scope: "me"), conflict: .overwrite, writers: w2, isCancelled: { stop })
        XCTAssertTrue(stopped.cancelled)
        XCTAssertEqual(w2.calls.count, 1)
    }

    func testSendsABotsNotesInBatchesThenItsAttachments() async {
        let base = source(["A.md": "a ![[pic.png]]", "B.md": "b"])
        let vault = VaultSource(name: "Vault", files: base.files + [VaultFile(path: "pic.png", size: 3)], bytes: base.bytes)
        let plan = ObsidianVault.plan(VaultPlanInput(vaultName: "Vault", files: vault.files, destination: .bot, folder: "Vault"))
        let w = Writers()
        let done = await VaultImportRunner.run(plan: plan, source: vault, target: .bot(botId: "atlas"), conflict: .skip, writers: w)
        XCTAssertEqual(w.calls, ["bot:2+0", "bot:0+1"])
        XCTAssertEqual(w.attachments.first?.path, "memory-attachments/Vault/pic.png")
        XCTAssertEqual(w.attachments.first?.data, "AQID")
        XCTAssertEqual(done.outcomes.filter { $0.status == .written }.count, 3)
    }

    func testReadsAPickedFolder() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("vault-test-\(UUID().uuidString)/My Vault")
        try FileManager.default.createDirectory(at: dir.appendingPathComponent("sub"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: dir.appendingPathComponent(".obsidian"), withIntermediateDirectories: true)
        try "Hello\n".write(to: dir.appendingPathComponent("Home.md"), atomically: true, encoding: .utf8)
        try "Deep\n".write(to: dir.appendingPathComponent("sub/Deep.md"), atomically: true, encoding: .utf8)
        try "x".write(to: dir.appendingPathComponent(".env"), atomically: true, encoding: .utf8)
        try "{}".write(to: dir.appendingPathComponent(".obsidian/app.json"), atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        let source = try VaultSource.readFolder(at: dir)
        XCTAssertEqual(source.name, "My Vault")
        XCTAssertEqual(source.files.map(\.path).sorted(), [".env", ".obsidian/app.json", "Home.md", "sub/Deep.md"])
        XCTAssertEqual(source.files.first { $0.path == "Home.md" }?.text, "Hello\n")
        XCTAssertNil(source.files.first { $0.path == ".env" }?.text)
    }
}
