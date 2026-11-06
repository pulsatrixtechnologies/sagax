// The Achievements tab of a person's panel (#2117): compact summary (level,
// title, points and a bar to the next level), the last unlocks, then every
// achievement as a grid of icons. Title and points never sit on the name
// line. A private card stays a private note on the parent sheet.
import CompanionCore
import SwiftUI

struct PersonAchievementsView: View {
    @Environment(\.themePalette) var themePalette
    let card: PublicAchievementCard
    var language: String?

    private var categories: [PersonAchievementCategory] { PersonPanelAchievements.categories(card) }
    private var recent: [PersonAchievementTile] { PersonPanelAchievements.recent(card) }
    private var unlockedCount: Int { categories.reduce(0) { $0 + $1.unlocked } }
    private var totalCount: Int { categories.reduce(0) { $0 + $1.tiles.count } }
    private var titleName: String? {
        card.titleName?.resolved(language)
    }
    private var level: AchievementLevel? {
        guard let points = card.points else { return nil }
        return AchievementLevel(points: points)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            summary
            if recent.isEmpty, card.unlocked.isEmpty {
                Text(String(localized: "No achievements yet."))
                    .font(.system(size: 12.5))
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("person-achievements-empty")
            }
            if !recent.isEmpty {
                recentSection
            }
            if !categories.isEmpty {
                allSection
            }
        }
        .accessibilityIdentifier("person-achievements")
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(RadialGradient(
                            colors: [Color.white, Color(red: 0.88, green: 0.66, blue: 0.18)],
                            center: UnitPoint(x: 0.35, y: 0.3),
                            startRadius: 0,
                            endRadius: 22
                        ))
                        .frame(width: 40, height: 40)
                    Image(systemName: "trophy.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color(red: 0.11, green: 0.08, blue: 0.02))
                }
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        if let level {
                            Text(String(localized: "Level \(level.level)"))
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(Theme.textPrimary)
                                .accessibilityIdentifier("person-member-level")
                        }
                        if let titleName {
                            Text(verbatim: titleName)
                                .font(.system(size: 12.5))
                                .foregroundStyle(Theme.textSecondary)
                                .lineLimit(1)
                                .accessibilityIdentifier("person-member-title")
                        }
                    }
                    Text(String(localized: "\(unlockedCount) of \(totalCount) unlocked"))
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 0)
            }
            if let points = card.points, let level {
                let span = max(1, level.to - level.from)
                let into = max(0, points - level.from)
                VStack(alignment: .leading, spacing: 4) {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Theme.hairline)
                            Capsule()
                                .fill(Color(red: 0.88, green: 0.66, blue: 0.18))
                                .frame(width: geo.size.width * min(1, CGFloat(into) / CGFloat(span)))
                        }
                    }
                    .frame(height: 6)
                    .accessibilityIdentifier("person-member-points")
                    HStack {
                        Text(verbatim: "\(points) / \(level.to)")
                        Spacer()
                        Text(String(localized: "Level \(level.level + 1)"))
                    }
                    .font(.system(size: 11.5).monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .padding(14)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityIdentifier("person-achievements-summary")
    }

    private var recentSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(String(localized: "Recent unlocks"))
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 6) {
                ForEach(recent) { tile in
                    HStack(spacing: 8) {
                        Image(systemName: tile.unlocked ? "seal.fill" : "lock.fill")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(tile.unlocked ? Theme.textPrimary : Theme.textTertiary)
                            .frame(width: 22, height: 22)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(verbatim: tile.item.name.resolved(language))
                                .font(.system(size: 12.5))
                                .foregroundStyle(Theme.textPrimary)
                                .lineLimit(1)
                            if let at = tile.unlockedAt {
                                Text(verbatim: shortDate(at))
                                    .font(.system(size: 11).monospacedDigit())
                                    .foregroundStyle(Theme.textTertiary)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .accessibilityIdentifier("person-recent-achievement.\(tile.id)")
                }
            }
        }
        .accessibilityIdentifier("person-achievements-recent")
    }

    private var allSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(String(localized: "All achievements"))
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
            ForEach(categories) { group in
                VStack(alignment: .leading, spacing: 6) {
                    Text(AchievementWording.categoryLabel(group.category))
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 6), spacing: 6) {
                        ForEach(group.tiles) { tile in
                            Image(systemName: tile.unlocked ? "seal.fill" : "lock.fill")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(tile.unlocked ? Theme.textPrimary : Theme.textTertiary.opacity(0.55))
                                .frame(width: 36, height: 36)
                                .background(Theme.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                .accessibilityLabel(Text(verbatim: tile.item.name.resolved(language)))
                                .accessibilityIdentifier("person-achievement.\(tile.id)")
                        }
                    }
                }
            }
        }
        .accessibilityIdentifier("person-achievements-all")
    }

    private func shortDate(_ at: Double) -> String {
        let date = Date(timeIntervalSince1970: at / 1000)
        let sameYear = Calendar.current.component(.year, from: date) == Calendar.current.component(.year, from: Date())
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.setLocalizedDateFormatFromTemplate(sameYear ? "MMMd" : "MMMdyyyy")
        return formatter.string(from: date)
    }
}
