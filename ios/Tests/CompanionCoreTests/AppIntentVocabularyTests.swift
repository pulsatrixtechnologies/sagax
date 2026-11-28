// Tests que les fichiers de vocabulaire Siri des intents Sagax
// (AppIntentVocabulary.plist) sont présents et bien formés.
// Ils sont copiés par Xcode dans le binaire du target `Sagax`.
// Ce test valide leur existence et leur structure via swift test,
// ce qui sert d'assertion de présence en source / test d'empaquetage
// pour l'issue #5532.

import Foundation
import XCTest

/// Chargement robuste d'un plist XML/binaire.
private func loadPlist(from url: URL) -> [String: Any]? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    do {
        return try PropertyListSerialization.propertyList(
            from: data,
            options: .mutableContainers,
            format: nil
        ) as? [String: Any]
    } catch {
        return nil
    }
}

/// Chemin vers le dossier App/ à partir de #filePath de ce fichier.
/// #filePath pointe sur .../ios/Tests/CompanionCoreTests/AppIntentVocabularyTests.swift
/// On remonte à .../ios/ puis on va dans App/.
private let appDir = URL(fileURLWithPath: #filePath)
    .absoluteURL
    .deletingLastPathComponent() // CompanionCoreTests/
    .deletingLastPathComponent() // Tests/
    .deletingLastPathComponent() // ios/
    .appendingPathComponent("App")

/// Les quatre variantes linguistiques attendues.
private let expectedLocales = ["Base", "en", "fr", "pt-BR"]

/// Les deux intents Siri requis.
private let requiredIntents = ["INSendMessageIntent", "INStartCallIntent"]

final class AppIntentVocabularyTests: XCTestCase {

    // MARK: - Fichiers de vocabulaire présents

    func testVocabularyFilesExist() throws {
        let errors: [String] = expectedLocales.compactMap { locale in
            let url = appDir
                .appendingPathComponent("\(locale).lproj")
                .appendingPathComponent("AppIntentVocabulary.plist")
            guard FileManager.default.fileExists(atPath: url.path) else {
                return "AppIntentVocabulary.plist absent pour \(locale).lproj"
            }
            return nil
        }
        XCTAssertTrue(errors.isEmpty, "Fichiers de vocabulaire manquants: \(errors.joined(separator: ", "))")
    }

    // MARK: - Structure minimale valide

    func testVocabularyFilesHaveValidStructure() throws {
        for locale in expectedLocales {
            let url = appDir
                .appendingPathComponent("\(locale).lproj")
                .appendingPathComponent("AppIntentVocabulary.plist")
            XCTAssert(FileManager.default.fileExists(atPath: url.path),
                      "Le fichier pour \(locale) n'existe pas: \(url.path)")

            guard let plist = loadPlist(from: url) else {
                XCTFail("Structure invalide pour \(locale).lproj/AppIntentVocabulary.plist")
                continue
            }
            guard let intentPhrases = plist["IntentPhrases"] as? [[String: Any]] else {
                XCTFail("IntentPhrases absent ou de type incorrect pour \(locale).lproj")
                continue
            }

            XCTAssert(intentPhrases.count > 0,
                      "IntentPhrases vide pour \(locale).lproj")

            // Chaque entrée doit avoir IntentName et IntentExamples.
            for (index, entry) in intentPhrases.enumerated() {
                guard let intentName = entry["IntentName"] as? String, !intentName.isEmpty else {
                    XCTFail("Entrée \(index) de \(locale): IntentName manquant ou vide")
                    continue
                }
                guard let examples = entry["IntentExamples"] as? [String] else {
                    XCTFail("Entrée \(index) de \(locale) (\(intentName)): IntentExamples manquant")
                    continue
                }
                XCTAssert(!examples.isEmpty,
                          "Entrée \(intentName) de \(locale): au moins un exemple requis")

                // Exemples non vides.
                let emptyExamples = examples.filter { $0.trimmingCharacters(in: .whitespaces).isEmpty }
                XCTAssert(emptyExamples.count == examples.count || emptyExamples.isEmpty,
                          "Entrée \(intentName) de \(locale): exemples non vides attendus")
            }
        }
    }

    // MARK: - Intentes requis présents dans chaque locale

    func testRequiredIntentsPresentPerLocale() throws {
        for locale in expectedLocales {
            let url = appDir
                .appendingPathComponent("\(locale).lproj")
                .appendingPathComponent("AppIntentVocabulary.plist")

            guard let plist = loadPlist(from: url) else {
                XCTFail("Impossible de charger \(locale).lproj/AppIntentVocabulary.plist")
                continue
            }
            guard let intentPhrases = plist["IntentPhrases"] as? [[String: Any]] else {
                XCTFail("IntentPhrases invalide pour \(locale).lproj")
                continue
            }

            let foundNames = intentPhrases.compactMap { $0["IntentName"] as? String }

            for required in requiredIntents {
                XCTAssertTrue(foundNames.contains(required),
                              "\(required) manquant dans \(locale).lproj (trouvés: \(foundNames.joined(separator: ", ")))")
            }
        }
    }

    // MARK: - Exemples non vides par intent et locale

    func testIntentExamplesNotEmpty() throws {
        for locale in expectedLocales {
            let url = appDir
                .appendingPathComponent("\(locale).lproj")
                .appendingPathComponent("AppIntentVocabulary.plist")

            guard let plist = loadPlist(from: url) else { continue }
            guard let intentPhrases = plist["IntentPhrases"] as? [[String: Any]] else { continue }

            for entry in intentPhrases {
                guard let intentName = entry["IntentName"] as? String,
                      let examples = entry["IntentExamples"] as? [String] else { continue }
                let nonEmpty = examples.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
                XCTAssert(nonEmpty.count >= 2,
                          "\(locale).lproj/\(intentName): \(nonEmpty.count) exemples non vides (< 2)")
            }
        }
    }
}
