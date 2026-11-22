import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { cjkSearchText, cjkTokenParts, ensureSearchIndex, ftsPhrase, SEARCH_MARK, withoutSearchMarks } from "./cjk-search.ts";

const SPEC = { table: "messages", fts: "messages_fts", view: "messages_search", triggerPrefix: "messages_fts" };

describe("CJK search text", () => {
  it("splits every CJK character from its neighbours and leaves other text alone", () => {
    expect(cjkSearchText("Buy milk")).toBeNull();
    expect(cjkSearchText(null)).toBeNull();
    const indexed = cjkSearchText("iPhone15电池, 图书馆")!;
    expect(withoutSearchMarks(indexed)).toBe("iPhone15电池, 图书馆");
    expect(indexed.split(SEARCH_MARK)).toEqual(["iPhone15", "电", "池, 图", "书", "馆"]);
  });

  it("queries a CJK term as a phrase of its characters", () => {
    expect(ftsPhrase("图书馆")).toBe('"图 书 馆"');
    expect(ftsPhrase("iphone15电池")).toBe('"iphone15 电 池"');
    expect(ftsPhrase("milk")).toBe('"milk"');
  });

  it("makes bigrams of CJK runs and keeps the rest", () => {
    expect(cjkTokenParts("iphone15的电池")).toEqual({ other: ["iphone15"], bigrams: ["电池"] });
    expect(cjkTokenParts("图书馆")).toEqual({ other: [], bigrams: ["图书", "书馆"] });
  });

  it("keeps a lone Han character as its own term, never a lone kana", () => {
    expect(cjkTokenParts("猫")).toEqual({ other: [], bigrams: ["猫"] });
    expect(cjkTokenParts("猫的粮")).toEqual({ other: [], bigrams: ["猫", "粮"] });
    expect(cjkTokenParts("を")).toEqual({ other: [], bigrams: [] });
  });
});

describe("the search index", () => {
  const legacy = () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE messages (id TEXT PRIMARY KEY, text TEXT);
      CREATE VIRTUAL TABLE messages_fts USING fts5(text, content='messages', content_rowid='rowid', tokenize='unicode61');
      CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
    `);
    db.prepare("INSERT INTO messages (id, text) VALUES (?, ?)").run("zh", "周三下午三点要去社区图书馆还书。");
    db.prepare("INSERT INTO messages (id, text) VALUES (?, ?)").run("en", "Buy milk tomorrow");
    return db;
  };
  const match = (db: DatabaseSync, query: string) =>
    (db.prepare("SELECT m.id FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid WHERE messages_fts MATCH ?").all(query) as Array<{ id: string }>)
      .map((row) => row.id);

  it("migrates a plain-text index so a word inside a Chinese sentence is found, and English still is", () => {
    const db = legacy();
    expect(match(db, '"图书馆"')).toEqual([]);
    ensureSearchIndex(db, SPEC);
    expect(match(db, ftsPhrase("图书馆"))).toEqual(["zh"]);
    expect(match(db, '"milk"')).toEqual(["en"]);
    db.exec("INSERT INTO messages_fts(messages_fts) VALUES ('integrity-check')");
  });

  it("is unchanged by a second open, and keeps writes, edits and deletes in step", () => {
    const db = legacy();
    ensureSearchIndex(db, SPEC);
    ensureSearchIndex(db, SPEC);
    db.prepare("INSERT INTO messages (id, text, search_text) VALUES (?, ?, ?)").run("new", "冰箱冷冻室设在零下十八度", cjkSearchText("冰箱冷冻室设在零下十八度"));
    expect(match(db, ftsPhrase("冷冻"))).toEqual(["new"]);
    db.prepare("UPDATE messages SET text = ?, search_text = ? WHERE id = ?").run("阳台绿萝每周浇水", cjkSearchText("阳台绿萝每周浇水"), "new");
    expect(match(db, ftsPhrase("冷冻"))).toEqual([]);
    expect(match(db, ftsPhrase("绿萝"))).toEqual(["new"]);
    db.prepare("DELETE FROM messages WHERE id = ?").run("zh");
    expect(match(db, ftsPhrase("图书"))).toEqual([]);
    db.exec("INSERT INTO messages_fts(messages_fts) VALUES ('integrity-check')");
  });
});
