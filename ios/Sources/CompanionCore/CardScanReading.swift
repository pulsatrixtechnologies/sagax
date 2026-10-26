import Foundation

// 2026-10-21 (parité R10, ligne 84): "Photos de la carte". The phone reads
// the text of one or two photos of a payment card ON THE DEVICE (Vision, in
// the app) and this fold picks the number, the expiry and the name on the
// card out of those lines to fill the New card form. Nothing here is sent
// anywhere, logged or kept: the person checks the fields and adds the card
// as if typed. The security code is never read from a photo (the person
// types it).

public struct CardScanResult: Equatable, Sendable {
    public var pan: String?
    public var expMonth: Int?
    public var expYear: Int?
    public var holder: String?

    public init(pan: String? = nil, expMonth: Int? = nil, expYear: Int? = nil, holder: String? = nil) {
        self.pan = pan
        self.expMonth = expMonth
        self.expYear = expYear
        self.holder = holder
    }

    public var isEmpty: Bool { pan == nil && expMonth == nil && holder == nil }

    /// Fields read on a later photo fill only what the earlier ones missed.
    public func merged(with other: CardScanResult) -> CardScanResult {
        CardScanResult(
            pan: pan ?? other.pan,
            expMonth: expMonth ?? other.expMonth,
            expYear: expMonth != nil ? expYear : other.expYear,
            holder: holder ?? other.holder
        )
    }
}

public enum CardScanReading {
    /// Luhn check of a 13 to 19 digit number.
    /// ASCII 0 to 9 only (review of #954): never another script's digits.
    static func isDigit(_ character: Character) -> Bool {
        character.isASCII && character.isNumber
    }

    public static func luhnValid(_ digits: String) -> Bool {
        guard (13...19).contains(digits.count), digits.allSatisfy(isDigit) else { return false }
        var sum = 0
        for (index, character) in digits.reversed().enumerated() {
            guard var value = character.wholeNumberValue else { return false }
            if index % 2 == 1 {
                value *= 2
                if value > 9 { value -= 9 }
            }
            sum += value
        }
        return sum % 10 == 0
    }

    /// Words printed on cards that are never the holder's name.
    private static let notAName: Set<String> = [
        "VISA", "MASTERCARD", "DEBIT", "CREDIT", "VALID", "THRU", "VALID THRU", "GOOD THRU", "EXPIRES", "EXP", "MEMBER SINCE",
        "PLATINUM", "GOLD", "WORLD", "ELITE", "BUSINESS", "INFINITE", "SIGNATURE", "AMERICAN EXPRESS", "AMEX", "INTERAC",
        "BANK", "BANQUE", "CARTE", "CARD", "CLIENT", "CUSTOMER", "AUTHORIZED SIGNATURE", "NOT VALID UNLESS SIGNED",
    ]

    /// The number, the expiry and the name on the card, from the text lines
    /// one photo gave. A number must pass the Luhn check; an expiry is
    /// MM/YY or MM/YYYY with a real month, the latest one when several
    /// dates are printed (a "member since" date comes first); a name is a
    /// line of two to four words in capitals with no digit.
    public static func read(lines: [String], now: Date = Date()) -> CardScanResult {
        var result = CardScanResult()
        let year = Calendar(identifier: .gregorian).component(.year, from: now)
        // the number: digits of one line, or two to five groups on one line
        for line in lines {
            let digits = line.filter(isDigit)
            let groups = line.split(whereSeparator: { $0 == " " || $0 == "-" })
            if groups.allSatisfy({ $0.allSatisfy(isDigit) }) || groups.count == 1, luhnValid(digits) {
                result.pan = digits
                break
            }
        }
        // the expiry
        var best: (month: Int, year: Int)?
        let pattern = try? NSRegularExpression(pattern: #"(?<!\d)(0[1-9]|1[0-2])\s?[/\-]\s?(\d{4}|\d{2})(?!\d)"#)
        for line in lines {
            let range = NSRange(line.startIndex..., in: line)
            for match in pattern?.matches(in: line, range: range) ?? [] {
                guard let monthRange = Range(match.range(at: 1), in: line), let yearRange = Range(match.range(at: 2), in: line),
                      let month = Int(line[monthRange]), var found = Int(line[yearRange]) else { continue }
                if found < 100 { found += 2000 }
                guard found >= year - 1, found <= year + 20 else { continue }
                if best == nil || (found, month) > (best!.year, best!.month) { best = (month, found) }
            }
        }
        if let best {
            result.expMonth = best.month
            result.expYear = best.year
        }
        // the name on the card
        for line in lines {
            let text = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty, !text.contains(where: \.isNumber), text == text.uppercased(),
                  !notAName.contains(text) else { continue }
            let words = text.split(separator: " ")
            guard (2...4).contains(words.count), words.allSatisfy({ word in word.count >= 1 && word.allSatisfy { $0.isLetter || $0 == "-" || $0 == "'" || $0 == "." } }),
                  !words.contains(where: { notAName.contains(String($0)) }) else { continue }
            result.holder = text
            break
        }
        return result
    }
}
