// A coding job in the chat it was launched from (#2148): the RoutineRunCard
// pattern with a "Coding" kind. While it runs: the status with a spinner,
// the elapsed time and Stop. Once it ends the card stays, finished, with
// the branch, a short result and the PR link when there is one. It never
// opens a thread, a thread panel or "Go to conversation" (unified chat).
import CompanionCore
import SwiftUI
import UIKit

struct CodingJobCardView: View {
    @Environment(\.themePalette) var themePalette
    let job: CodingJobView
    let threadId: String
    var now: Date = Date()
    var onStop: (() -> Void)? = nil

    private var live: Bool { job.state.isActive }
    private var status: String { CodingChatRules.statusLabel(job.state) }
    private var elapsed: String? {
        guard job.state != .queued else { return nil }
        let end = (live ? now.timeIntervalSince1970 * 1000 : (job.endedAt ?? now.timeIntervalSince1970 * 1000))
        let ms = end - job.startedAt
        guard ms > 0 else { return nil }
        return BotActivityRules.duration(ms)
    }
    private var line: String? { job.result ?? (live ? job.currentStep : nil) }
    private var prLabel: String {
        if let number = job.pr?.number {
            return String(localized: "PR #\(number)")
        }
        return String(localized: "Pull request")
    }
    private var tone: Color {
        switch job.state {
        case .failed: Theme.danger
        case .waiting: Theme.warning
        case .queued: Theme.accentText
        default: Theme.textSecondary
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            provenance
            bubble
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: String(localized: "Coding job \(job.title): \(status)")))
        .accessibilityIdentifier("coding-job-card-\(threadId)")
    }

    private var provenance: some View {
        HStack(spacing: 6) {
            Image(systemName: "chevron.left.forwardslash.chevron.right")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .accessibilityHidden(true)
            Text("Coding")
                .font(.system(size: 11))
                .foregroundStyle(Theme.textSecondary)
            dot
            Text(Date(timeIntervalSince1970: job.startedAt / 1000), format: .dateTime.month(.abbreviated).day().hour().minute())
                .font(.system(size: 11))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
            dot
            HStack(spacing: 4) {
                if live {
                    ProgressView().controlSize(.mini)
                }
                Text(verbatim: status)
                    .foregroundStyle(tone)
            }
            .font(.system(size: 11))
            .accessibilityIdentifier("coding-job-status")
            if let elapsed {
                dot
                Text(verbatim: elapsed)
                    .font(.system(size: 11).monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("coding-job-elapsed")
            }
            if live, let onStop {
                dot
                Button {
                    Haptics.selection()
                    onStop()
                } label: {
                    HStack(spacing: 2) {
                        Image(systemName: "stop.fill").font(.system(size: 8))
                        Text("Stop")
                    }
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Theme.danger)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: String(localized: "Stop \(job.title)")))
                .accessibilityIdentifier("coding-job-stop")
            }
        }
        .lineLimit(1)
        .accessibilityIdentifier("coding-job-provenance")
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: job.title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(BubbleColor.theirsText)
                .accessibilityIdentifier("coding-job-title")
            if let line {
                Text(verbatim: line)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("coding-job-result")
            }
            if job.branch != nil || job.pr != nil {
                HStack(spacing: 12) {
                    if let branch = job.branch {
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.triangle.branch")
                                .font(.system(size: 11))
                            Text(verbatim: branch)
                                .font(.system(size: 11.5, design: .monospaced))
                                .lineLimit(1)
                            if let repo = job.repo {
                                Text(verbatim: "· \(repo)")
                                    .foregroundStyle(Theme.textTertiary)
                                    .lineLimit(1)
                            }
                        }
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("coding-job-branch")
                    }
                    if let pr = job.pr, let url = URL(string: pr.url) {
                        Button {
                            Haptics.selection()
                            UIApplication.shared.open(url)
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "arrow.triangle.pull")
                                    .font(.system(size: 11))
                                Text(verbatim: prLabel)
                                    .font(.system(size: 12, weight: .medium))
                            }
                            .foregroundStyle(Theme.accentText)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(verbatim: String(localized: "Open \(prLabel) on GitHub")))
                        .accessibilityIdentifier("coding-job-pr")
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(BubbleColor.theirs)
        )
        .accessibilityIdentifier("coding-job-bubble")
    }

    private var dot: some View {
        Text("·").font(.system(size: 11)).foregroundStyle(Theme.textTertiary).accessibilityHidden(true)
    }
}

/// Loads the coding activity entry for a parallel task and draws CodingJobCardView
/// while it is a coding job; otherwise falls back to the caller.
struct CodingJobCardLoader<Fallback: View>: View {
    @EnvironmentObject private var session: Session
    let ownerId: String
    let threadId: String
    var hint: String? = nil
    var onStop: (() -> Void)? = nil
    @ViewBuilder var fallback: () -> Fallback

    @State private var job: CodingJobView?
    @State private var knownCoding = false

    var body: some View {
        Group {
            if let job {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    CodingJobCardView(
                        job: job,
                        threadId: threadId,
                        now: context.date,
                        onStop: job.state.isActive ? onStop : nil
                    )
                }
            } else if knownCoding {
                // Still loading the first detail: keep the slot quiet.
                ProgressView().controlSize(.small).frame(maxWidth: .infinity, alignment: .leading)
            } else {
                fallback()
            }
        }
        .task(id: "\(ownerId):\(threadId):\(hint ?? "")") {
            await poll()
        }
    }

    private func poll() async {
        guard let client = session.profileClient else { return }
        let key = "thread:\(threadId)"
        while !Task.isCancelled {
            do {
                let detail = try await client.botActivityDetail(botId: ownerId, itemId: key)
                guard CodingJobCard.isCodingJob(detail.item) else {
                    knownCoding = false
                    job = nil
                    return
                }
                knownCoding = true
                var result: String?
                if !detail.item.status.isActive {
                    if let page = try? await client.messages(threadId: threadId, limit: 20) {
                        result = CodingJobCard.lastBotText(page.messages)
                    }
                    job = CodingJobCard.view(item: detail.item, result: result)
                    return
                }
                job = CodingJobCard.view(item: detail.item, result: nil)
                try? await Task.sleep(nanoseconds: 4_000_000_000)
            } catch {
                // Not readable: the caller keeps its own row.
                knownCoding = false
                job = nil
                return
            }
        }
    }
}
