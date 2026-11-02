// The card of a phone call or a purchase a bot asks for (OutboundCard.tsx,
// parité Grok Bot V4, 59, 83): who it calls and from which line, why, the
// exact words, the callback number, the disclosure and "I confirm the
// number"; or what a purchase buys, from where, with which card. One answer
// covers one action: Call or Cancel, Pay or Cancel. No Always
// allow. Never a card number, a security code or an id.
//
// A conversation call (mode `conversation`) shows the objective, the most it
// may last and the language, the opening line, its guidance and voicemail
// words behind a disclosure; once placed, the live card (phase chip, timer,
// transcript, End call); once ended, the result with the recording player
// when present. The other party's words stay plain text (verbatim, never
// markdown).
import AVFoundation
import CompanionCore
import SwiftUI
import UIKit

struct OutboundCardView: View {
    @EnvironmentObject private var session: Session
    let card: OutboundCardData
    let accent: Color
    @Environment(\.desktopChatText) private var desktop
    @State private var busy: Bool?
    @State private var answered: String?
    @State private var error = ""
    /// Call only after the person confirms the number on the card.
    @State private var confirmed = false
    /// Instructions and voicemail words of a conversation call.
    @State private var showDetails = false
    @State private var showTranscript: Bool
    @State private var showLiveTranscript = true
    @State private var hanging = false
    @State private var nowMs = Date().timeIntervalSince1970 * 1000

    init(card: OutboundCardData, accent: Color, transcriptOpen: Bool = OutboundCardView.previewTranscriptOpen) {
        self.card = card
        self.accent = accent
        _showTranscript = State(initialValue: transcriptOpen)
    }

    /// Screenshot harness only: `-outbound-transcript-open` opens the transcripts.
    static var previewTranscriptOpen: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("-outbound-transcript-open")
        #else
        false
        #endif
    }

    private var status: String { answered ?? card.status }
    private var pending: Bool { status == "pending" }
    private var viewCard: OutboundCardData {
        var copy = card
        copy.status = status
        return copy
    }
    private var live: Bool { viewCard.isLiveConversation }
    private var ended: Bool { card.isConversation && card.result != nil }

    var body: some View {
        let ink = ApprovalInk.of(desktop, accent: desktop?.accent ?? accent)
        VStack(alignment: .leading, spacing: 0) {
            header(ink)
            VStack(alignment: .leading, spacing: 8) {
                Text(verbatim: title)
                    .font(ink.font(14, .semibold))
                    .foregroundStyle(ink.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("outbound-title")
                if card.isConversation {
                    if live { liveConversationBody(ink) }
                    else if ended, let result = card.result { endedConversationBody(result, ink) }
                    else { conversationBody(ink) }
                } else if card.kind == .call {
                    callBody(ink)
                } else {
                    purchaseBody(ink)
                }
                if let line = statusLine {
                    Text(verbatim: line)
                        .font(ink.font(12, .regular))
                        .foregroundStyle(ink.secondary)
                        .accessibilityIdentifier("outbound-status")
                }
                if let via = card.via, !via.isEmpty, !pending, !live {
                    Text("Answered by \(via)")
                        .font(ink.font(12, .regular))
                        .foregroundStyle(ink.secondary)
                }
                if !error.isEmpty {
                    Text(verbatim: error)
                        .font(ink.font(12, .regular))
                        .foregroundStyle(ink.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if pending { buttons(ink) }
            }
            .padding(12)
        }
        .frame(maxWidth: 560, alignment: .leading)
        .background(desktop?.panel ?? Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(ink.hairline.opacity(0.4), lineWidth: 1))
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("outbound-card-\(card.kind.rawValue)")
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { _ in
            guard live else { return }
            nowMs = Date().timeIntervalSince1970 * 1000
        }
    }

    // MARK: Parts

    private func header(_ ink: ApprovalInk) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 12, weight: .medium))
            Text(headerLabel).lineLimit(1)
            if live {
                phaseChip(phaseLabel(card.phase ?? "dialing"), tone: ink.accent, fill: ink.accent.opacity(0.12), ink: ink)
                    .accessibilityIdentifier("outbound-phase-chip")
                Text(verbatim: OutboundCallResult.duration(OutboundCardRules.liveElapsed(startedAt: card.liveStartedAt, now: nowMs)))
                    .font(ink.font(11.5, .regular))
                    .foregroundStyle(ink.tertiary)
                    .monospacedDigit()
                    .accessibilityIdentifier("outbound-live-timer")
            } else if ended, let result = card.result {
                phaseChip(String(localized: "Ended"), tone: ink.secondary, fill: ink.inset, ink: ink)
                    .accessibilityIdentifier("outbound-phase-chip")
                Text(verbatim: OutboundCallResult.duration(result.durationSec))
                    .font(ink.font(11.5, .regular))
                    .foregroundStyle(ink.tertiary)
                    .monospacedDigit()
            }
            Spacer(minLength: 8)
            Text(verbatim: card.botName).lineLimit(1)
        }
        .font(ink.font(12, .regular))
        .foregroundStyle(ink.secondary)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ink.inset.opacity(0.6))
    }

    private func phaseChip(_ label: String, tone: Color, fill: Color, ink: ApprovalInk) -> some View {
        Text(verbatim: label)
            .font(ink.font(11.5, .medium))
            .foregroundStyle(tone)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(fill, in: Capsule())
    }

    private var headerLabel: LocalizedStringKey {
        if live || ended { return "Phone call" }
        if card.isConversation { return "Conversation call" }
        return card.kind == .call ? "Phone call" : "Purchase"
    }

    private var icon: String {
        switch card.kind {
        case .call: status == "denied" ? "phone.down" : (live || ended || card.isConversation) ? "phone.bubble" : "phone"
        case .purchase, .unknown: (card.flights?.isEmpty == false) ? "airplane" : "bag"
        }
    }

    private var money: String { OutboundCardRules.money(card.amount, currency: card.currency) }

    private var calleeLine: String {
        let destination = card.destination ?? ""
        if let name = card.calleeName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            return "\(name) · \(destination)"
        }
        return destination
    }

    private var title: String {
        switch card.kind {
        case .call:
            if card.isConversation, pending {
                let destination = card.destination ?? ""
                if let name = card.calleeName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
                    return String(localized: "Call \(name)? \(destination)")
                }
                return String(localized: "Call \(destination)?")
            }
            if live || ended { return calleeLine }
            return String(localized: "Call to \(card.destination ?? "")")
        case .purchase, .unknown:
            if status == "done" {
                switch OutboundCardRules.bought(card) {
                case .flightOne: return String(localized: "1 flight purchased · \(money)")
                case let .flights(count): return String(localized: "\(count) flights purchased · \(money)")
                case .itemOne: return String(localized: "1 item purchased · \(money)")
                case let .items(count): return String(localized: "\(count) items purchased · \(money)")
                case .done: return String(localized: "Purchased · \(money)")
                }
            }
            return String(localized: "Pay \(money) at \(card.merchant ?? "")")
        }
    }

    private var statusLine: String? {
        switch OutboundCardRules.status(card, status: status) {
        case .callApproved: String(localized: "Allowed. \(card.botName) is placing the call.")
        case .callDone: String(localized: "Call placed.")
        case .callDenied: String(localized: "Not called.")
        case .callFailed: String(localized: "The call failed.")
        case .callInProgress: String(localized: "Call in progress. The result appears here when it ends.")
        case .purchaseApproved: String(localized: "Allowed. \(card.botName) can pay.")
        case .purchaseDenied: String(localized: "Declined.")
        case nil: nil
        }
    }

    private func phaseLabel(_ phase: String) -> String {
        switch phase {
        case "dialing": return String(localized: "Dialing")
        case "ringing": return String(localized: "Ringing")
        case "on_hold": return String(localized: "On hold")
        case "in_call": return String(localized: "In call")
        case "transferred": return String(localized: "Transferred")
        case "ended": return String(localized: "Ended")
        default: return String(localized: "Dialing")
        }
    }

    @ViewBuilder
    private func callBody(_ ink: ApprovalInk) -> some View {
        if let from = card.from, !from.isEmpty {
            Text("From \(from)").font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
        }
        if let purpose = card.purpose, !purpose.isEmpty {
            (Text("Purpose:").foregroundColor(ink.secondary) + Text(verbatim: " \(purpose)").foregroundColor(ink.ink))
                .font(ink.font(13, .regular))
                .fixedSize(horizontal: false, vertical: true)
        }
        if let script = card.script, !script.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("What \(card.botName) will say").font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
                Text(verbatim: script)
                    .font(ink.font(12.5, .regular))
                    .foregroundStyle(ink.ink)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, 8)
                    .overlay(alignment: .leading) { Rectangle().fill(ink.hairline.opacity(0.6)).frame(width: 2) }
                    .accessibilityIdentifier("outbound-script")
            }
        }
        if let callback = card.callback, !callback.isEmpty {
            Text("Callback number said on the call: \(callback)").font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
        }
        if pending {
            Text("The call first says it is an AI assistant calling on your behalf, gives the callback number and how to stop the calls, says the message twice, then hangs up. Nothing is placed until you confirm the number and choose Call.")
                .font(ink.font(12, .regular))
                .foregroundStyle(ink.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Toggle(isOn: $confirmed) {
                Text("I confirm the number \(card.destination ?? "")")
                    .font(ink.font(12.5, .regular))
                    .foregroundStyle(ink.ink)
            }
            .toggleStyle(OutboundCheckboxStyle(tint: ink.accent))
            .accessibilityIdentifier("outbound-confirm")
        }
    }

    // MARK: Conversation call

    private var conversationMeta: String {
        var parts: [String] = []
        if let minutes = card.maxMinutes, minutes > 0 { parts.append(String(localized: "\(minutes) min max")) }
        switch card.language {
        case "fr": parts.append(String(localized: "In French"))
        case "en": parts.append(String(localized: "In English"))
        default: break
        }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private func conversationBody(_ ink: ApprovalInk) -> some View {
        let result = card.result
        if let objective = card.objective, !objective.isEmpty {
            (Text("Objective:").foregroundColor(ink.secondary) + Text(verbatim: " \(objective)").foregroundColor(ink.ink))
                .font(ink.font(13, .regular))
                .fixedSize(horizontal: false, vertical: true)
        }
        if result == nil {
            if let script = card.script, !script.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("What \(card.botName) says first").font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
                    quote(script, ink)
                        .accessibilityIdentifier("outbound-opening")
                }
            }
            if !conversationMeta.isEmpty {
                Text(verbatim: conversationMeta).font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
                    .accessibilityIdentifier("outbound-meta")
            }
            let instructions = card.instructions?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let voicemail = card.voicemail?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !instructions.isEmpty || !voicemail.isEmpty {
                disclosure("Instructions and voicemail", open: $showDetails, ink: ink)
                    .accessibilityIdentifier("outbound-details")
                if showDetails {
                    if !instructions.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Call instructions").font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
                            quote(instructions, ink)
                        }
                    }
                    if !voicemail.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Message left on voicemail").font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
                            quote(voicemail, ink)
                        }
                    }
                }
            }
        }
        if pending {
            Text("The call always opens by saying it is an AI assistant calling on your behalf. \(card.botName) then talks with the person to reach the objective and hangs up at the time limit at the latest. Nothing is placed until you confirm the number and choose Call.")
                .font(ink.font(12, .regular))
                .foregroundStyle(ink.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Toggle(isOn: $confirmed) {
                Text("I confirm the number \(card.destination ?? "")")
                    .font(ink.font(12.5, .regular))
                    .foregroundStyle(ink.ink)
            }
            .toggleStyle(OutboundCheckboxStyle(tint: ink.accent))
            .accessibilityIdentifier("outbound-confirm")
        }
        if let result { callResult(result, ink) }
    }

    // MARK: Live / ended conversation

    private var waitingPickup: Bool {
        let phase = card.phase ?? "dialing"
        return phase == "dialing" || phase == "ringing"
    }

    private var liveStream: [(id: String, kind: String, text: String, speaker: String?)] {
        var items: [(at: Double, index: Int, kind: String, text: String, speaker: String?)] = []
        for (index, line) in (card.liveTranscript ?? []).enumerated() {
            items.append((line.at ?? Double(index), index, "line", line.text, line.speaker))
        }
        for (index, event) in (card.liveEvents ?? []).enumerated() {
            items.append((event.at, index, "event", eventLine(event), nil))
        }
        items.sort { lhs, rhs in
            if lhs.at != rhs.at { return lhs.at < rhs.at }
            if lhs.kind == rhs.kind { return lhs.index < rhs.index }
            return lhs.kind == "line"
        }
        return items.map { ("\($0.kind)-\($0.index)-\($0.at)", $0.kind, $0.text, $0.speaker) }
    }

    private func eventLine(_ event: OutboundCardData.LiveEvent) -> String {
        switch event.kind {
        case .hold: return String(localized: "On hold")
        case .resume: return String(localized: "Back on the call")
        case .dtmf: return String(localized: "Pressed \(event.detail)")
        case .transfer: return String(localized: "Transferred to \(event.detail)")
        case .unknown: return event.detail
        }
    }

    private func speakerName(_ speaker: String) -> String {
        switch speaker {
        case "bot":
            return card.botName
        case "system":
            return String(localized: "Live transcript")
        default:
            let name = card.calleeName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return name.isEmpty ? String(localized: "Other party") : name
        }
    }

    @ViewBuilder
    private func liveConversationBody(_ ink: ApprovalInk) -> some View {
        if waitingPickup {
            Text("Waiting for them to pick up")
                .font(ink.font(12, .regular))
                .foregroundStyle(ink.secondary)
                .accessibilityIdentifier("outbound-waiting")
        }
        let stream = liveStream
        if !stream.isEmpty || !waitingPickup {
            disclosure(showLiveTranscript ? "Hide live transcript" : "Show live transcript", open: $showLiveTranscript, ink: ink)
                .accessibilityIdentifier("outbound-live-toggle")
            if showLiveTranscript {
                VStack(alignment: .leading, spacing: 6) {
                    if stream.isEmpty {
                        Text("Call in progress. The result appears here when it ends.")
                            .font(ink.font(12, .regular))
                            .foregroundStyle(ink.tertiary)
                    }
                    ForEach(stream, id: \.id) { item in
                        if item.kind == "event" {
                            Text(verbatim: item.text)
                                .font(ink.font(12, .regular))
                                .italic()
                                .foregroundStyle(ink.tertiary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        } else {
                            let speaker = item.speaker ?? "callee"
                            (Text(verbatim: speakerName(speaker))
                                .font(ink.font(12.5, .medium))
                                .foregroundColor(speaker == "bot" ? ink.accent : speaker == "system" ? ink.tertiary : ink.secondary)
                             + Text(verbatim: " " + item.text)
                                .font(ink.font(12.5, .regular))
                                .foregroundColor(ink.ink))
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .textSelection(.enabled)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .frame(maxHeight: 280, alignment: .top)
                .background(ink.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .accessibilityIdentifier("outbound-live-transcript")
            }
        }
        Button { hangUp() } label: {
            HStack(spacing: 6) {
                if hanging { ProgressView().controlSize(.mini) }
                else { Image(systemName: "phone.down").font(.system(size: 12, weight: .semibold)) }
                Text("End call")
            }
            .font(ink.font(13, .medium))
            .foregroundStyle(ink.danger)
            .padding(.horizontal, 14)
            .frame(height: 32)
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(ink.danger.opacity(0.4), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(hanging)
        .opacity(hanging ? 0.4 : 1)
        .accessibilityIdentifier("outbound-hangup")
        .padding(.top, 2)
    }

    @ViewBuilder
    private func endedConversationBody(_ result: OutboundCallResult, _ ink: ApprovalInk) -> some View {
        Text("Call ended · \(card.destination ?? "")")
            .font(ink.font(12, .regular))
            .foregroundStyle(ink.secondary)
            .accessibilityIdentifier("outbound-ended-line")
        OutboundRecordingPlayer(card: card, result: result, ink: ink)
        callResult(result, ink)
    }

    private func hangUp() {
        guard let client = session.settingsClient else { return }
        Haptics.selection()
        hanging = true
        error = ""
        Task {
            do {
                try await client.hangUpOutbound(card)
            } catch {
                self.error = error.localizedDescription
                hanging = false
            }
        }
    }

    private func quote(_ text: String, _ ink: ApprovalInk) -> some View {
        Text(verbatim: text)
            .font(ink.font(12.5, .regular))
            .foregroundStyle(ink.ink)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.leading, 8)
            .overlay(alignment: .leading) { Rectangle().fill(ink.hairline.opacity(0.6)).frame(width: 2) }
    }

    private func disclosure(_ label: LocalizedStringKey, open: Binding<Bool>, ink: ApprovalInk) -> some View {
        Button { open.wrappedValue.toggle() } label: {
            HStack(spacing: 4) {
                Image(systemName: open.wrappedValue ? "chevron.down" : "chevron.right").font(.system(size: 10, weight: .semibold))
                Text(label)
            }
            .font(ink.font(12, .regular))
            .foregroundStyle(ink.secondary)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(open.wrappedValue ? .isSelected : [])
    }

    private func outcomeText(_ result: OutboundCallResult) -> String {
        let outcome: String = switch result.outcome {
        case .completed: String(localized: "Call completed")
        case .voicemail: String(localized: "Voicemail")
        case .noAnswer: String(localized: "No answer")
        case .busy: String(localized: "Busy")
        case .failed: String(localized: "Call failed")
        case .unknown: String(localized: "Call ended")
        }
        guard result.outcome == .completed, let endedBy = result.endedBy else { return outcome }
        let reason: String? = switch endedBy {
        case .goal: String(localized: "objective reached")
        case .callee: String(localized: "the other party ended the call")
        case .stopRequest: String(localized: "the other party asked to stop")
        case .timeLimit: String(localized: "time limit reached")
        case .hangUp: String(localized: "hung up")
        case .unknown: nil
        }
        return reason.map { "\(outcome) · \($0)" } ?? outcome
    }

    private func outcomeTone(_ outcome: OutboundCallResult.Outcome, _ ink: ApprovalInk) -> (Color, Color) {
        switch outcome {
        case .completed: (ink.accent, ink.accent.opacity(0.12))
        case .noAnswer, .busy: (Theme.warning, Theme.warning.opacity(0.15))
        case .failed: (ink.danger, ink.danger.opacity(0.12))
        case .voicemail, .unknown: (ink.secondary, ink.inset)
        }
    }

    @ViewBuilder
    private func bullets(_ title: LocalizedStringKey, _ lines: [String], _ ink: ApprovalInk) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(verbatim: "•")
                    Text(verbatim: line).fixedSize(horizontal: false, vertical: true)
                }
                .font(ink.font(12.5, .regular))
                .foregroundStyle(ink.ink)
            }
        }
    }

    @ViewBuilder
    private func callResult(_ result: OutboundCallResult, _ ink: ApprovalInk) -> some View {
        let tone = outcomeTone(result.outcome, ink)
        let points = result.points.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        let commitments = result.commitments.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        HStack(spacing: 8) {
            Text(verbatim: outcomeText(result))
                .font(ink.font(11.5, .medium))
                .foregroundStyle(tone.0)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(tone.1, in: Capsule())
                .accessibilityIdentifier("outbound-outcome")
            Text("Duration \(OutboundCallResult.duration(result.durationSec))")
                .font(ink.font(12, .regular))
                .foregroundStyle(ink.secondary)
        }
        if result.doNotCallAgain {
            Text("The other party asked not to be called again. \(card.botName) will not call this number again for you.")
                .font(ink.font(12, .regular))
                .foregroundStyle(Theme.warning)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.warning.opacity(0.1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .accessibilityIdentifier("outbound-dnc")
        }
        if !points.isEmpty { bullets("Summary", points, ink) }
        if !commitments.isEmpty {
            bullets("Commitments and next steps", commitments, ink).accessibilityIdentifier("outbound-commitments")
        }
        if result.transcriptExpired {
            Text("Transcript expired (30 days)").font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
        } else if !result.transcript.isEmpty {
            disclosure(showTranscript ? "Hide transcript" : "Show transcript", open: $showTranscript, ink: ink)
                .accessibilityIdentifier("outbound-transcript-toggle")
            if showTranscript {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(result.transcript.enumerated()), id: \.offset) { _, line in
                        (Text(verbatim: line.isBot ? card.botName : String(localized: "Other party"))
                            .font(ink.font(12.5, .medium))
                            .foregroundColor(line.isBot ? ink.accent : ink.secondary)
                         + Text(verbatim: " " + line.text)
                            .font(ink.font(12.5, .regular))
                            .foregroundColor(ink.ink))
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if result.truncated {
                        Text("Transcript cut: only the first part is kept.").font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
                    }
                }
                .textSelection(.enabled)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(ink.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .accessibilityIdentifier("outbound-transcript")
            }
        }
    }

    @ViewBuilder
    private func purchaseBody(_ ink: ApprovalInk) -> some View {
        let done = status == "done"
        if done, let merchant = card.merchant, !merchant.isEmpty {
            let order = card.orderRef.map { " · " + String(localized: "Order \($0)") } ?? ""
            Text(verbatim: merchant + order).font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
        }
        if let items = card.items, !items.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(spacing: 8) {
                        Text(verbatim: ((item.quantity ?? 1) > 1 ? "\(item.quantity ?? 1) × " : "") + item.name)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if let price = item.price, !price.isEmpty {
                            Text(verbatim: OutboundCardRules.money(price, currency: card.currency)).foregroundStyle(ink.secondary)
                        }
                    }
                    .font(ink.font(12.5, .regular))
                    .foregroundStyle(ink.ink)
                }
            }
        }
        if let flights = card.flights, !flights.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(flights.enumerated()), id: \.offset) { _, leg in
                    let extra = [leg.flight, leg.passenger].compactMap { $0 }.filter { !$0.isEmpty }.map { " · " + $0 }.joined()
                    Text(verbatim: String(localized: "\(leg.from) to \(leg.to), \(leg.date)") + extra)
                        .font(ink.font(12.5, .regular))
                        .foregroundStyle(ink.ink)
                }
            }
        }
        if done, card.declared == true {
            Text("Receipt declared by the bot, not read by Sagax from the shop's page.")
                .font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        if done, let total = card.mismatchTotal, !total.isEmpty {
            Text("The shop confirmed \(OutboundCardRules.money(total, currency: card.currency)), not the \(money) you allowed. Check the order.")
                .font(ink.font(12, .regular)).foregroundStyle(Theme.warning)
                .fixedSize(horizontal: false, vertical: true)
        }
        if done, let tracking = card.tracking {
            OrderTrackingView(tracking: tracking, ink: ink)
        }
        if !done, let label = card.cardLabel, !label.isEmpty {
            Text("Pay with \(label)").font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
        }
        if pending {
            Text("The bot never sees the card number or the security code. Nothing is charged until you allow it.")
                .font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func buttons(_ ink: ApprovalInk) -> some View {
        HStack(spacing: 8) {
            Button { answer(true) } label: {
                HStack(spacing: 6) {
                    if busy == true { ProgressView().controlSize(.mini).tint(.white) }
                    Text(card.kind == .call ? "Call" : "Pay")
                }
                .font(ink.font(13, .medium))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .frame(height: 32)
                .background(ink.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            .disabled(busy != nil || (card.kind == .call && !confirmed))
            .opacity(busy != nil || (card.kind == .call && !confirmed) ? 0.4 : 1)
            .accessibilityIdentifier("outbound-yes")
            Button { answer(false) } label: {
                HStack(spacing: 6) {
                    if busy == false { ProgressView().controlSize(.mini) }
                    Text(card.kind == .call ? (card.isConversation ? "Cancel" : "Don't call") : "Cancel")
                }
                .font(ink.font(13, .regular))
                .foregroundStyle(ink.ink)
                .padding(.horizontal, 14)
                .frame(height: 32)
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(ink.hairline.opacity(0.6), lineWidth: 1))
            }
            .disabled(busy != nil)
            .opacity(busy != nil ? 0.4 : 1)
            .accessibilityIdentifier("outbound-no")
        }
        .buttonStyle(.plain)
        .padding(.top, 2)
    }

    private func answer(_ yes: Bool) {
        guard let client = session.settingsClient else { return }
        Haptics.selection()
        busy = yes
        error = ""
        Task {
            do {
                try await client.answerOutbound(card, yes: yes, confirmed: confirmed)
                answered = yes ? "approved" : "denied"
            } catch {
                self.error = error.localizedDescription
            }
            busy = nil
        }
    }
}

/// Recording player on the ended conversation card (AVAudioPlayer + speed).
private struct OutboundRecordingPlayer: View {
    @EnvironmentObject private var session: Session
    let card: OutboundCardData
    let result: OutboundCallResult
    let ink: ApprovalInk
    @StateObject private var player = OutboundRecordingAudio()
    @State private var loading = false
    @State private var loadError = ""
    @State private var shareFile: ShareFile?

    private var hasRecording: Bool { OutboundCardRules.recordingPath(card) != nil }
    private var hasTranscript: Bool {
        !(result.transcript.isEmpty && (card.liveTranscript ?? []).isEmpty)
    }

    var body: some View {
        if hasRecording || hasTranscript {
            VStack(alignment: .leading, spacing: 8) {
                if hasRecording {
                    HStack(spacing: 8) {
                        Text("Recording")
                            .font(ink.font(12, .medium))
                            .foregroundStyle(ink.secondary)
                        Button {
                            togglePlayback()
                        } label: {
                            Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(ink.ink)
                                .frame(width: 28, height: 28)
                                .background(ink.inset, in: Circle())
                        }
                        .buttonStyle(.plain)
                        .disabled(loading)
                        .accessibilityIdentifier("outbound-recording-play")
                        if loading { ProgressView().controlSize(.mini) }
                        Menu {
                            ForEach(OutboundRecordingAudio.rates, id: \.self) { rate in
                                Button(rateLabel(rate)) { player.setRate(rate) }
                            }
                        } label: {
                            Text(rateLabel(player.rate))
                                .font(ink.font(11.5, .regular))
                                .foregroundStyle(ink.secondary)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(ink.hairline.opacity(0.6), lineWidth: 1))
                        }
                        .accessibilityLabel(Text("Speed"))
                        .accessibilityIdentifier("outbound-speed")
                        Spacer(minLength: 0)
                    }
                }
                if !loadError.isEmpty {
                    Text(verbatim: loadError)
                        .font(ink.font(12, .regular))
                        .foregroundStyle(ink.danger)
                }
                HStack {
                    Spacer(minLength: 0)
                    Menu {
                        if hasRecording {
                            Button("Download recording") { downloadRecording() }
                        }
                        if hasTranscript {
                            Button("Copy transcript") { copyTranscript() }
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(ink.tertiary)
                            .frame(width: 28, height: 28)
                            .contentShape(Rectangle())
                    }
                    .accessibilityIdentifier("outbound-more")
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(ink.inset.opacity(0.6), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .accessibilityIdentifier("outbound-recording-player")
            .sheet(item: $shareFile) { file in
                ActivityShareSheet(items: [file.url])
            }
        }
    }

    private func rateLabel(_ rate: Float) -> String {
        if rate == 1 { return "1x" }
        if rate == Float(Int(rate)) { return "\(Int(rate))x" }
        return String(format: "%.2gx", rate)
    }

    private func togglePlayback() {
        if player.isReady {
            player.isPlaying ? player.pause() : player.play()
            return
        }
        guard let client = session.settingsClient else { return }
        loading = true
        loadError = ""
        Task {
            do {
                let data = try await client.outboundRecording(card)
                try player.load(data)
                player.play()
            } catch {
                loadError = error.localizedDescription
            }
            loading = false
        }
    }

    private func transcriptText() -> String {
        if !result.transcript.isEmpty {
            return result.transcript.map {
                "\($0.isBot ? card.botName : String(localized: "Other party")): \($0.text)"
            }.joined(separator: "\n")
        }
        return (card.liveTranscript ?? [])
            .filter { $0.speaker != "system" }
            .map {
                let name = $0.isBot
                    ? card.botName
                    : (card.calleeName?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
                        ?? String(localized: "Other party"))
                return "\(name): \($0.text)"
            }
            .joined(separator: "\n")
    }

    private func copyTranscript() {
        let text = transcriptText()
        guard !text.isEmpty else { return }
        UIPasteboard.general.string = text
    }

    private func downloadRecording() {
        guard let client = session.settingsClient else { return }
        Task {
            do {
                let data = try await client.outboundRecording(card)
                let url = FileManager.default.temporaryDirectory
                    .appendingPathComponent("sagax-call-\(card.id).m4a")
                try data.write(to: url, options: .atomic)
                await MainActor.run { shareFile = ShareFile(url: url) }
            } catch {
                await MainActor.run { loadError = error.localizedDescription }
            }
        }
    }
}

@MainActor
private final class OutboundRecordingAudio: NSObject, ObservableObject, AVAudioPlayerDelegate {
    static let rates: [Float] = [1, 1.25, 1.5, 2]
    @Published private(set) var isPlaying = false
    @Published private(set) var rate: Float = 1
    private var player: AVAudioPlayer?
    var isReady: Bool { player != nil }

    func load(_ data: Data) throws {
        let next = try AVAudioPlayer(data: data)
        next.delegate = self
        next.enableRate = true
        next.rate = rate
        next.prepareToPlay()
        player = next
        isPlaying = false
    }

    func play() {
        guard let player else { return }
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default)
        try? session.setActive(true)
        player.rate = rate
        isPlaying = player.play()
    }

    func pause() {
        player?.pause()
        isPlaying = false
    }

    func setRate(_ next: Float) {
        rate = next
        player?.rate = next
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.isPlaying = false
            self.player?.currentTime = 0
        }
    }
}

private extension String {
    var nilIfEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// The desktop's checkbox: a square that fills with the accent.
private struct OutboundCheckboxStyle: ToggleStyle {
    let tint: Color

    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .font(.system(size: 16))
                    .foregroundStyle(configuration.isOn ? tint : Theme.textSecondary)
                configuration.label
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(configuration.isOn ? .isSelected : [])
    }
}

/// Where the parcel is (the desktop's OrderTrackingView): the step, four
/// bars, the carrier and its number, the expected day, the tracking page.
struct OrderTrackingView: View {
    let tracking: OutboundCardData.Tracking
    let ink: ApprovalInk
    @Environment(\.openURL) private var openURL

    private func label(_ step: String) -> String {
        switch step {
        case "ordered": String(localized: "Ordered")
        case "shipped": String(localized: "Shipped")
        case "in_transit": String(localized: "In transit")
        case "out_for_delivery": String(localized: "Out for delivery")
        case "delivered": String(localized: "Delivered")
        default: String(localized: "Delivery problem")
        }
    }

    private var eta: String? {
        guard let eta = tracking.eta, tracking.step != "delivered" else { return nil }
        let parser = DateFormatter()
        parser.calendar = Calendar(identifier: .gregorian)
        parser.timeZone = TimeZone(identifier: "UTC")
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: eta) else { return eta }
        var style = Date.FormatStyle.dateTime.weekday(.abbreviated).month(.abbreviated).day()
        style.timeZone = TimeZone(identifier: "UTC") ?? .current
        return date.formatted(style)
    }

    var body: some View {
        let at = tracking.stepIndex
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: tracking.isProblem ? "exclamationmark.triangle" : "shippingbox")
                    .foregroundStyle(tracking.isProblem ? Theme.warning : ink.secondary)
                Text(verbatim: label(tracking.step))
                    .foregroundStyle(tracking.isProblem ? Theme.warning : ink.ink)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if let eta {
                    Text("Expected \(eta)").foregroundStyle(ink.secondary).lineLimit(1)
                }
            }
            .font(ink.font(12, .medium))
            HStack(alignment: .top, spacing: 4) {
                ForEach(Array(OutboundCardData.Tracking.stepper.enumerated()), id: \.offset) { index, step in
                    let reached = !tracking.isProblem && index <= at
                    VStack(alignment: .leading, spacing: 4) {
                        Capsule().fill(reached ? ink.success : ink.ink.opacity(0.1)).frame(height: 4)
                        Text(verbatim: label(step))
                            .font(ink.font(11, .regular))
                            .foregroundStyle(reached ? ink.ink : ink.tertiary)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Delivery progress"))
            .accessibilityValue(Text(verbatim: label(tracking.step)))
            let carrier = [tracking.carrier, tracking.number, tracking.note].compactMap { $0 }.filter { !$0.isEmpty }
            if !carrier.isEmpty {
                Text(verbatim: carrier.joined(separator: " · ")).font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
            }
            if let link = tracking.url, let url = URL(string: link), url.scheme == "https" || url.scheme == "http" {
                Button { openURL(url) } label: {
                    Label("Track the parcel", systemImage: "arrow.up.right.square").font(ink.font(12, .medium))
                }
                .buttonStyle(.plain)
                .foregroundStyle(ink.accent)
                .accessibilityIdentifier("order-tracking-link")
            }
        }
        .padding(10)
        .background(ink.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}
