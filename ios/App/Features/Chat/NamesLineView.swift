// The quiet centred line every trace between bots uses, the desktop's
// NamesLine (src/components/BotNamesLine.tsx): a muted verb, then each bot as
// its small face and its name in the neutral ink, joined with the locale's
// conjunction; past three names, "and N others" shows the whole list and
// folds it back; an optional tail after a middle dot. A name with somewhere
// to go opens the exchange where the chat is, never another conversation.
//
// #3581: a request received from a bot or an AI client draws here ("Asked by
// [face] Bot B"), without the quoted request; requests in a row are one line.
import SwiftUI
import CompanionCore

/// One party named on the line.
struct NamesLineParty: Identifiable {
    var id: String
    var botId: String?
    var name: String
    /// An AI client: the neutral agent icon in place of a face.
    var agent = false
    /// #4112: the person's phone line ("sms" or "call"): a phone glyph.
    var phone: String? = nil
    var open: (() -> Void)? = nil
}

struct NamesLineView: View {
    let verb: String
    let parties: [NamesLineParty]
    var tail: String? = nil
    var tailDanger = false
    var testId = "names-line"
    @Environment(\.desktopChatText) private var desktop
    @State private var expanded = false

    /// The first three names, as the desktop (MESSAGED_LINE_SHOWN).
    static let shown = 3

    var body: some View {
        let ink = ApprovalInk.of(desktop, accent: Theme.textSecondary)
        Group {
            if expanded || parties.count <= 1 {
                // every name: the line wraps, centred, never cutting a name
                DesktopFlowLayout(spacing: 6, lineSpacing: 4, centresItems: true) {
                    pieces(shown: parties.count, ink: ink)
                }
            } else {
                // #3581: one line; where it does not fit, fewer names and a
                // larger count ("A, B and 13 others"), the count always whole
                ViewThatFits(in: .horizontal) {
                    ForEach(NamesLineFit.shownCounts(total: parties.count, most: Self.shown), id: \.self) { shown in
                        HStack(spacing: 6) { pieces(shown: shown, ink: ink) }
                            .fixedSize()
                    }
                    // not even one name and the count fit: the wrapping line
                    DesktopFlowLayout(spacing: 6, lineSpacing: 4, centresItems: true) {
                        pieces(shown: 1, ink: ink)
                    }
                }
            }
        }
        .font(ink.font(12, .regular))
        .lineLimit(1)
        // 10 / 5: the desktop's 4px 10px around an 18px line; the 16pt
        // face sets the phone's line, so 5 keeps the same 26 tall row
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .frame(maxWidth: .infinity, alignment: .center)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(testId)
    }

    /// The verb, the first `shown` names joined by the locale's words, the
    /// count of the others, and the tail. The tail (after its middle dot)
    /// is one piece with the last name or the count, so a wrapped line
    /// never begins with "·".
    @ViewBuilder
    private func pieces(shown: Int, ink: ApprovalInk) -> some View {
        let names = Array(parties.prefix(shown))
        let others = parties.count - names.count
        let count = names.count + (others > 0 ? 1 : 0)
        Text(verbatim: verb).foregroundStyle(ink.secondary).fixedSize()
        if names.isEmpty { tailPiece(ink) }
        ForEach(Array(names.enumerated()), id: \.element.id) { index, party in
            if index > 0, index == count - 1 {
                Text(verbatim: and).foregroundStyle(ink.secondary).fixedSize()
            }
            // a comma hugs the name before it; the tail hugs the last piece
            let last = others == 0 && index == names.count - 1
            HStack(spacing: 6) {
                name(party, ink: ink, comma: index < count - 2)
                if last { tailPiece(ink) }
            }
            .fixedSize()
            .layoutPriority(1)
        }
        if others > 0 {
            Text(verbatim: and).foregroundStyle(ink.secondary).fixedSize()
            HStack(spacing: 6) {
                Button {
                    Haptics.selection()
                    expanded = true
                } label: {
                    Text(verbatim: others == 1
                        ? String(localized: "chat.messagedOthers.one", defaultValue: "\(others) other")
                        : String(localized: "chat.messagedOthers.other", defaultValue: "\(others) others"))
                        .font(ink.font(12, .medium))
                        .foregroundStyle(ink.ink)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("\(testId)-more")
                tailPiece(ink)
            }
            .fixedSize()
        } else if expanded, parties.count > 1, parties.count > Self.shown {
            Button {
                Haptics.selection()
                expanded = false
            } label: {
                Text("Show less").font(ink.font(12, .medium)).foregroundStyle(ink.ink)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("\(testId)-more")
        }
    }

    @ViewBuilder
    private func tailPiece(_ ink: ApprovalInk) -> some View {
        if let tail {
            HStack(spacing: 6) {
                Text(verbatim: "·").foregroundStyle(ink.secondary).accessibilityHidden(true)
                Text(verbatim: tail)
                    .foregroundStyle(tailDanger ? ink.danger : ink.secondary)
                    .lineLimit(1)
            }
            .fixedSize()
            .accessibilityIdentifier("\(testId)-tail")
        }
    }

    /// The locale's conjunction before the last name ("A, B and C", "A, B et C").
    private var and: String { String(localized: "chat.names.and", defaultValue: "and") }

    @ViewBuilder
    private func name(_ party: NamesLineParty, ink: ApprovalInk, comma: Bool = false) -> some View {
        let label = HStack(spacing: 5) {
            face(party, ink: ink)
            (Text(verbatim: party.name).foregroundColor(ink.ink)
                + Text(verbatim: comma ? "," : "").foregroundColor(ink.secondary))
                .font(ink.font(12, .medium))
                .lineLimit(1)
                .truncationMode(.tail)
                .fixedSize()
        }
        if let open = party.open {
            Button {
                Haptics.selection()
                open()
            } label: { label }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Open the exchange with \(party.name)"))
                .accessibilityIdentifier("\(testId)-recipient")
        } else {
            label.accessibilityIdentifier("\(testId)-recipient")
        }
    }

    @ViewBuilder
    private func face(_ party: NamesLineParty, ink: ApprovalInk) -> some View {
        if let phone = party.phone {
            Image(systemName: phone == "call" ? "phone" : "iphone")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(ink.tertiary)
                .frame(width: 16, height: 16)
        } else if party.agent {
            Image(systemName: "cpu")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(ink.tertiary)
                .frame(width: 16, height: 16)
        } else if let id = party.botId, let bot = SessionHub.session.state.bot(id) {
            BotMascotView(bot: bot, size: 16, state: .idle, animated: false)
                .frame(width: 16, height: 16)
        } else {
            Image(systemName: "person.crop.circle")
                .font(.system(size: 13))
                .foregroundStyle(ink.tertiary)
                .frame(width: 16, height: 16)
        }
    }
}

/// #3581: a burst of requests a bot received, as one names line. The name
/// opens that asker's exchanges of the line, newest first.
struct IncomingLineView: View {
    let line: IncomingLine
    @State private var opened: IncomingAsker?

    var body: some View {
        NamesLineView(
            verb: String(localized: "chat.incoming.askedBy", defaultValue: "Asked by"),
            parties: line.askers.map { asker in
                NamesLineParty(
                    id: asker.key, botId: asker.botId,
                    name: IncomingAskerName.of(asker),
                    agent: asker.agent,
                    phone: asker.phone,
                    open: { opened = asker }
                )
            },
            tail: line.requestCount.map { String(localized: "chat.incoming.requests", defaultValue: "\($0) requests") }
                ?? line.trace.map(IncomingTraceWords.of),
            tailDanger: line.trace == "failed",
            testId: "incoming-line"
        )
        .sheet(item: $opened) { asker in
            IncomingExchangeSheet(asker: asker, exchanges: line.exchanges(of: asker))
        }
    }
}

/// How the line names an asker: a bot's name, "AI client", or the phone
/// line with its caller label, "Text Message (514 555-0142)" (#4112).
enum IncomingAskerName {
    static func of(_ asker: IncomingAsker) -> String {
        if let phone = asker.phone {
            let call = phone == "call"
            if asker.name.isEmpty {
                return call ? String(localized: "chat.incoming.phoneCall", defaultValue: "Phone call") : String(localized: "chat.incoming.textMessage", defaultValue: "Text Message")
            }
            return call
                ? String(localized: "chat.incoming.phoneCallFrom", defaultValue: "Phone call (\(asker.name))")
                : String(localized: "chat.incoming.textMessageFrom", defaultValue: "Text Message (\(asker.name))")
        }
        if asker.name.isEmpty { return asker.agent ? String(localized: "AI client") : String(localized: "a teammate") }
        return asker.name
    }
}

/// The desktop's words for an exchange that left no answer
/// (`chat.askLine.trace.*`).
enum IncomingTraceWords {
    static func of(_ trace: String) -> String {
        switch trace {
        case "failed": String(localized: "chat.askLine.trace.failed", defaultValue: "did not finish")
        case "stopped": String(localized: "chat.askLine.trace.stopped", defaultValue: "stopped before an answer")
        default: String(localized: "chat.askLine.trace.silent", defaultValue: "finished without a reply")
        }
    }
}

extension IncomingAsker: @retroactive Identifiable {
    public var id: String { key }
}

/// The exchanges behind a name: each stored request, then the stored reply,
/// newest first, drawn as the chat draws a bot's words.
struct IncomingExchangeSheet: View {
    let asker: IncomingAsker
    let exchanges: [IncomingExchange]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ForEach(exchanges) { exchange in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(exchange.date, format: .dateTime.month().day().hour().minute())
                                .font(.system(size: 11.5))
                                .foregroundStyle(Theme.textTertiary)
                            if let request = exchange.request?.trimmingCharacters(in: .whitespacesAndNewlines), !request.isEmpty {
                                bubble(request, mine: true)
                            }
                            if let reply = exchange.reply {
                                bubble(reply, mine: false)
                            } else if let trace = exchange.trace {
                                Text(verbatim: IncomingTraceWords.of(trace))
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                        }
                        .accessibilityIdentifier("incoming-exchange-\(exchange.id)")
                    }
                }
                .padding(16)
            }
            .navigationTitle(IncomingAskerName.of(asker))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Done")) { dismiss() }
                }
            }
        }
    }

    private func bubble(_ text: String, mine: Bool) -> some View {
        MarkdownText(source: text, inert: true)
            .foregroundStyle(mine ? BubbleColor.mineText : BubbleColor.theirsText)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, Theme.Chat.bubblePaddingH)
            .padding(.vertical, Theme.Chat.bubblePaddingV)
            .background(RoundedRectangle(cornerRadius: Theme.Metric.bubbleRadius, style: .continuous).fill(mine ? BubbleColor.mine : BubbleColor.theirs))
            .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
    }
}

private extension IncomingExchange {
    var date: Date { Date(timeIntervalSince1970: at / 1000) }
}
