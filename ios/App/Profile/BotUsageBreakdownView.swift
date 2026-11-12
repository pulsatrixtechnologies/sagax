// Analytics tab, the desktop's BotUsageBreakdownSection (#2612, #3030,
// #3401): who uses what on this bot, over 7 days, 30 days or this month, in
// $ or in tokens, under a grey group label, money in the reader's language.
// The splits are the sources and the people (#4077: no account or model group).
// One bar per row in a single hue (the rows are their own legend); the top
// six rows, then the rest folded into "Others (N)" that opens them.
import CompanionCore
import SwiftUI

struct BotUsageBreakdownView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let bot: Bot

    @State private var period: BotUsagePeriod = .days30
    @State private var inTokens = false
    @State private var breakdown: BotUsageBreakdown?
    @State private var error: String?
    @State private var openOthers: Set<String> = []

    private var accent: Color { MausPalette.color((session.state.bot(bot.id) ?? bot).color) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            BotProfileGroupLabel(title: "Usage statistics")
                .accessibilityHint(Text("Who uses what: each source and person, in $ and in tokens."))
            controls
            if let error {
                ProfileCard {
                    HStack(spacing: 8) {
                        Text(verbatim: error)
                            .font(Theme.Profile.labelFont)
                            .foregroundStyle(Theme.textSecondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button("Retry") { Task { await load() } }
                            .font(Theme.Font.label)
                            .accessibilityIdentifier("bot-usage-breakdown.retry")
                    }
                    .padding(.horizontal, Theme.Profile.textInset)
                    .padding(.vertical, 12)
                }
            } else if let breakdown {
                totalsCard(breakdown)
                if !breakdown.days.isEmpty { daysCard(breakdown) }
                split("By source", breakdown.bySource.map(sourceNamed), id: "source")
                split("By person", breakdown.byPerson, id: "person")
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
            }
        }
        .task(id: period) { await load() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-usage-breakdown")
    }

    private var controls: some View {
        HStack(spacing: 8) {
            Picker("Period", selection: $period) {
                Text("7 d").tag(BotUsagePeriod.days7)
                Text("30 d").tag(BotUsagePeriod.days30)
                Text("This month").tag(BotUsagePeriod.month)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("bot-usage-breakdown.period")
            Picker("Show in", selection: $inTokens) {
                Text("In $").tag(false)
                Text("In tokens").tag(true)
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 170)
            .accessibilityIdentifier("bot-usage-breakdown.unit")
        }
        .padding(.horizontal, Theme.Profile.cardMargin)
    }

    private func value(_ group: BotUsageGroup) -> String {
        inTokens ? BotUsageTotal.formatTokens(group.tokens) : (group.costUsd.map { ProfileMoney.format($0, currency: breakdown?.currency) } ?? "-")
    }

    private func amount(_ group: BotUsageGroup) -> Double {
        inTokens ? Double(group.tokens) : (group.costUsd ?? 0)
    }

    private func totalsCard(_ data: BotUsageBreakdown) -> some View {
        ProfileCard {
            HStack(alignment: .top, spacing: 0) {
                figure("Turns", "\(data.totals.turns)", id: "turns")
                figure("Tokens", BotUsageTotal.formatTokens(data.totals.tokens), id: "tokens")
                figure("Cost", data.totals.costUsd.map { ProfileMoney.format($0, currency: data.currency) } ?? "-", id: "cost")
            }
            .padding(.vertical, 12)
        }
    }

    private func figure(_ title: LocalizedStringKey, _ value: String, id: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(Theme.Profile.labelFont).foregroundStyle(Theme.textSecondary)
            Text(verbatim: value).font(Theme.Font.body.weight(.semibold)).foregroundStyle(Theme.textPrimary).monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, Theme.Profile.textInset)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("bot-usage-breakdown.\(id)")
    }

    /// One bar per day, the same hue as the rows.
    private func daysCard(_ data: BotUsageBreakdown) -> some View {
        let values = data.days.map { inTokens ? Double($0.tokens) : $0.costUsd }
        let peak = max(values.max() ?? 0, 0.000_001)
        return ProfileCard {
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(Array(values.enumerated()), id: \.offset) { _, v in
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(v > 0 ? accent : Theme.hairline)
                        .frame(height: max(2, 72 * v / peak))
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 76, alignment: .bottom)
            .padding(.horizontal, Theme.Profile.textInset)
            .padding(.vertical, 12)
            .accessibilityHidden(true)
        }
        .accessibilityIdentifier("bot-usage-breakdown.days")
    }

    @ViewBuilder
    private func split(_ title: LocalizedStringKey, _ groups: [BotUsageGroup], id: String) -> some View {
        if !groups.isEmpty {
            let ranked = BotUsageBreakdown.ranked(groups, inTokens: inTokens)
            let peak = max(ranked.top.map(amount).max() ?? 0, 0.000_001)
            VStack(alignment: .leading, spacing: 0) {
                ProfileSectionLabel(text: title)
                ProfileCard {
                    ForEach(Array(ranked.top.enumerated()), id: \.element.id) { index, group in
                        if index > 0 { ProfileDivider(leading: Theme.Profile.textInset) }
                        bar(group, peak: peak)
                    }
                    if !ranked.others.isEmpty {
                        if !ranked.top.isEmpty { ProfileDivider(leading: Theme.Profile.textInset) }
                        othersRow(ranked.others, id: id)
                        if openOthers.contains(id) {
                            ForEach(ranked.others) { group in
                                ProfileDivider(leading: Theme.Profile.textInset)
                                bar(group, peak: peak)
                            }
                        }
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("bot-usage-breakdown.\(id)")
        }
    }

    private func bar(_ group: BotUsageGroup, peak: Double) -> some View {
        let share = min(1, amount(group) / peak)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(verbatim: group.label)
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(verbatim: value(group))
                    .font(Theme.Profile.labelFont)
                    .foregroundStyle(Theme.textSecondary)
                    .monospacedDigit()
            }
            GeometryReader { geo in
                Capsule()
                    .fill(accent)
                    .frame(width: share < 0.02 ? 6 : max(6, geo.size.width * share), height: 6)
            }
            .frame(height: 6)
        }
        .padding(.horizontal, Theme.Profile.textInset)
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }

    private func othersRow(_ others: [BotUsageGroup], id: String) -> some View {
        Button {
            Haptics.selection()
            withAnimation(.snappy(duration: 0.2)) {
                if openOthers.contains(id) { openOthers.remove(id) } else { openOthers.insert(id) }
            }
        } label: {
            HStack {
                Text("Others (\(others.count))")
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.textTertiary)
                    .rotationEffect(.degrees(openOthers.contains(id) ? 0 : -90))
            }
            .padding(.horizontal, Theme.Profile.textInset)
            .frame(height: Theme.Profile.singleRow)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("bot-usage-breakdown.\(id).others")
    }

    /// The desktop's source words; a source not listed keeps its server label.
    private func sourceNamed(_ group: BotUsageGroup) -> BotUsageGroup {
        var named = group
        switch group.key {
        case "user": named.label = String(localized: "People")
        case "owner": named.label = String(localized: "Owner")
        case "routine": named.label = String(localized: "Routines")
        case "bot": named.label = String(localized: "Other bots")
        case "helper": named.label = String(localized: "Helpers")
        default: break
        }
        return named
    }

    private func load() async {
        guard let client = session.profileClient else { return }
        error = nil
        do {
            breakdown = try await client.botUsageBreakdown(botId: bot.id, period: period)
        } catch {
            breakdown = nil
            self.error = String(localized: "The usage could not load.")
        }
    }
}
