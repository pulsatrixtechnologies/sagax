// Tools > Memory manager helpers (desktop src/lib/memory-manager.test.ts).
import CompanionCore
import XCTest

final class MemoryManagerTests: XCTestCase {
    func testDetectsWholeDocumentJsonVsMarkdown() {
        XCTAssertEqual(MemoryManager.detectBodyKind("{\"a\":1}"), .json)
        XCTAssertEqual(MemoryManager.detectBodyKind("[1,2]"), .json)
        XCTAssertEqual(MemoryManager.detectBodyKind("# Hello\n\n- item"), .markdown)
        XCTAssertEqual(MemoryManager.detectBodyKind("not json {"), .markdown)
        XCTAssertEqual(MemoryManager.detectBodyKind("  {\"ok\":true}  "), .json)
    }

    func testSplitsJsonFencesOutOfMarkdown() {
        let parts = MemoryManager.splitJsonFences("Before\n```json\n{\"x\":1}\n```\nAfter")
        XCTAssertEqual(parts, [
            .text("Before\n"),
            .json("{\"x\":1}\n"),
            .text("\nAfter"),
        ])
    }

    func testFiltersNotesByTitleFolderTagsAndExcerpt() {
        let notes = [
            MemoryNoteRow(id: "1", title: "Dining", folder: "topics", tags: ["food"], excerpt: "pasta"),
            MemoryNoteRow(id: "2", title: "Travel", folder: "logs", tags: ["trip"], excerpt: "trains"),
        ]
        XCTAssertEqual(MemoryManager.filterNotes(notes, query: "pasta").map(\.id), ["1"])
        XCTAssertEqual(MemoryManager.filterNotes(notes, query: "TRIP").map(\.id), ["2"])
        XCTAssertEqual(MemoryManager.filterNotes(notes, query: "").map(\.id), ["1", "2"])
    }

    func testBrowseBotMapsOverview() throws {
        let json = """
        {
          "workspacePath": "/tmp/bot",
          "index": {
            "lines": 1, "bytes": 10, "maxLines": 100, "maxBytes": 1000,
            "loadedLines": 1, "loadedBytes": 10, "truncated": false
          },
          "topics": [
            { "path": "memory/dining.md", "name": "dining.md", "bytes": 4, "modifiedAt": 1000 }
          ],
          "logs": [
            { "path": "memory/log/2026-11-01.md", "name": "2026-11-01.md", "bytes": 2, "modifiedAt": 2000 }
          ]
        }
        """.data(using: .utf8)!
        let overview = try JSONDecoder().decode(MemoryOverview.self, from: json)
        let browse = MemoryManager.browseBot(overview: overview)
        XCTAssertEqual(browse.folders.map(\.id), ["topics", "logs"])
        XCTAssertEqual(browse.notes.map(\.id), ["MEMORY.md", "memory/dining.md", "memory/log/2026-11-01.md"])
        XCTAssertEqual(browse.notes.map(\.title), ["MEMORY.md", "dining", "2026-11-01"])
        XCTAssertTrue(browse.mayWrite)
    }

    func testOpenBotNoteDetectsBodyKind() {
        let doc = MemoryDoc(path: "memory/data.md", text: "{\"a\":1}", hash: "h1")
        let note = MemoryManager.openBotNote(doc: doc)
        XCTAssertEqual(note.title, "data")
        XCTAssertEqual(note.bodyKind, .json)
        XCTAssertEqual(note.hash, "h1")
    }

    func testBrowseAndOpenTeamEntries() {
        let entries = [
            TeamMemoryEntry(id: "e1", kind: "term", name: "VPN", detail: "corp tunnel", updatedAt: 1),
            TeamMemoryEntry(id: "e2", kind: "term", name: "SSO", detail: "okta", updatedAt: 2),
            TeamMemoryEntry(id: "e3", kind: "person", name: "Ada", detail: "chief", updatedAt: 3),
        ]
        let browse = MemoryManager.browseTeam(entries: entries)
        XCTAssertEqual(Set(browse.folders.map(\.id)), ["person", "term"])
        XCTAssertEqual(browse.notes.count, 3)
        let open = MemoryManager.openTeamNote(entry: entries[0])
        XCTAssertEqual(open.title, "VPN")
        XCTAssertEqual(open.body, "corp tunnel")
        XCTAssertEqual(open.bodyKind, .markdown)
    }

    func testBrowsePerspicaxRespectsFolderAndScope() throws {
        let json = """
        {
          "tiers": [
            {
              "scope": "me", "kind": "me", "name": "Personal", "may_write": true, "may_manage": true, "trashed": 2,
              "topics": [
                {
                  "topic": "notes", "count": 1,
                  "entries": [
                    { "id": "n1", "title": "Hello", "topic": "notes", "tags": ["a"], "excerpt": "hi" }
                  ]
                },
                {
                  "topic": "work", "count": 1,
                  "entries": [
                    { "id": "n2", "title": "Task", "topic": "work", "tags": [], "excerpt": "do" }
                  ]
                }
              ]
            }
          ]
        }
        """.data(using: .utf8)!
        let tree = try JSONDecoder().decode(PerspicaxTree.self, from: json)
        let all = MemoryManager.browsePerspicax(tree: tree)
        XCTAssertEqual(all.notes.count, 2)
        XCTAssertEqual(all.trashCount, 2)
        XCTAssertTrue(all.mayWrite)
        XCTAssertEqual(all.mayManage, true)
        let filtered = MemoryManager.browsePerspicax(tree: tree, folder: "notes")
        XCTAssertEqual(filtered.notes.map(\.id), ["n1"])
    }

    func testSlugTitleAndTags() {
        XCTAssertEqual(MemoryManager.slugTitle("Hello World!"), "hello-world")
        XCTAssertEqual(MemoryManager.slugTitle("   "), "note")
        XCTAssertEqual(MemoryManager.parseTags("a, b , ,c"), ["a", "b", "c"])
    }

    func testJsonTreeParseAndExpand() {
        let value = MemoryJsonTree.parse("{\"a\":[1,{\"b\":true}],\"c\":null}")
        XCTAssertNotNil(value)
        let open = MemoryJsonTree.expandAllPaths(value!)
        XCTAssertTrue(open.contains(MemoryJsonTree.rootPath))
        XCTAssertTrue(open.contains("$/a"))
        XCTAssertEqual(MemoryJsonTree.kind(of: value!), .object)
        XCTAssertNil(MemoryJsonTree.parse("not json"))
    }

    func testSourcesResponseDecodes() throws {
        let json = """
        {
          "sources": [
            { "id": "bot:b1", "kind": "bot", "name": "Atlas", "mayWrite": true, "botId": "b1" },
            { "id": "team:general", "kind": "team", "name": "General", "mayWrite": false, "section": "" },
            { "id": "perspicax", "kind": "perspicax", "name": "Perspicax", "mayWrite": true, "mayManage": true, "scope": "me" }
          ],
          "perspicax": { "available": true }
        }
        """.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(MemoryManagerSourcesResponse.self, from: json)
        XCTAssertEqual(decoded.sources.count, 3)
        XCTAssertEqual(decoded.sources[0].kind, .bot)
        XCTAssertTrue(decoded.perspicax.available)
    }

    func testExcerptFromBodyAsTheDesktopList() {
        XCTAssertEqual(MemoryManager.excerpt(fromBody: "---\ntitle: x\n---\n# MEMORY\n\nDurable notes this bot keeps between tasks."), "Durable notes this bot keeps between tasks.")
        XCTAssertEqual(MemoryManager.excerpt(fromBody: "## Head\n```\n- [x] **Done** with [[Note|the note]] and [link](https://x.y)"), "Done with the note and link")
        XCTAssertEqual(MemoryManager.excerpt(fromBody: "> [!note] Quoted\n"), "Quoted")
        XCTAssertEqual(MemoryManager.excerpt(fromBody: "1. First [[Target]]"), "First Target")
        XCTAssertEqual(MemoryManager.excerpt(fromBody: "{\"a\": 1}"), "{\"a\": 1}")
        XCTAssertEqual(MemoryManager.excerpt(fromBody: "# Only a heading\n---"), "")
        XCTAssertEqual(MemoryManager.excerpt(fromBody: String(repeating: "a", count: 200)).count, 160)
    }
}
