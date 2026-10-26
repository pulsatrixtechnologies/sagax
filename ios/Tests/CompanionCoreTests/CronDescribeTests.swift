import XCTest
@testable import CompanionCore

/// Same table as `src/lib/schedule-label.test.ts` (shared/cron-describe.ts):
/// the phone and the desktop say a cron the same way.
final class CronDescribeTests: XCTestCase {
    private let table: [(String, String, String)] = [
        ("0,17,20,40 8-18 * * 1-5", "Weekdays, 8 AM to 6 PM, at :00, :17, :20 and :40", "Du lundi au vendredi, de 8 h à 18 h, à :00, :17, :20 et :40"),
        ("15,45 * * * *", "Every hour at :15 and :45", "Toutes les heures à :15 et :45"),
        ("*/15 * * * *", "Every 15 minutes", "Toutes les 15 minutes"),
        ("* * * * *", "Every minute", "Chaque minute"),
        ("*/10 8-17 * * MON-FRI", "Weekdays, 8 AM to 5 PM, every 10 minutes", "Du lundi au vendredi, de 8 h à 17 h, toutes les 10 minutes"),
        ("0 */2 * * *", "Every 2 hours", "Toutes les 2 heures"),
        ("30 8-18/2 * * 1-5", "Weekdays, every 2 hours, 8 AM to 6 PM, at :30", "Du lundi au vendredi, toutes les 2 heures, de 8 h à 18 h, à :30"),
        ("0 9,17 * * 1,3,5", "Monday, Wednesday and Friday, at 9:00 AM and 5:00 PM", "Les lundis, mercredis et vendredis, à 9 h 00 et 17 h 00"),
        ("0 8 * * 6,0", "Weekends, at 8:00 AM", "Les fins de semaine, à 8 h 00"),
        ("0 8 * * 5-7", "Friday to Sunday, at 8:00 AM", "Du vendredi au dimanche, à 8 h 00"),
        ("0 8 * * MON", "Mondays, at 8:00 AM", "Le lundi, à 8 h 00"),
        ("0 12 1,15 * *", "On the 1st and 15th, at 12:00 PM", "Le 1er et 15 du mois, à 12 h 00"),
        ("0 9 * 1,4,7,10 1-5", "Weekdays, in January, April, July and October, at 9:00 AM", "Du lundi au vendredi, en janvier, avril, juillet et octobre, à 9 h 00"),
        ("0 9 * jun-aug *", "In June, July and August, at 9:00 AM", "En juin, juillet et août, à 9 h 00"),
        ("0 0 * * *", "At 12:00 AM", "À 0 h 00"),
    ]

    func testTableInBothLanguages() {
        for (expression, en, fr) in table {
            XCTAssertEqual(CronDescribe.describe(expression, language: .en), en, expression)
            XCTAssertEqual(CronDescribe.describe(expression, language: .fr), fr, expression)
        }
    }

    func testUnclearExpressionsStayRaw() {
        for expression in ["0 9 1 * 1", "0 9 ? * 1", "*/15 8,12 * * *", "61 9 * * *", "0 9 * *", "0 9 L * *", "0 9 * * 1#2"] {
            XCTAssertNil(CronDescribe.describe(expression, language: .en), expression)
            XCTAssertNil(CronDescribe.describe(expression, language: .fr), expression)
        }
    }
}
