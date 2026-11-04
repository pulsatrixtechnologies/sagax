// The iPad desktop shell's New bot (src/components/bot-wizard/BotWizard.tsx,
// its "choose" phase, and QuickCreate.tsx): one centred window over the app
// (max 760 wide, rounded 16, the panel's colour, a 40 % hairline), its
// header (the Pulsatrix mark, the Bot icon and "Create a bot", Later), the
// quick create (the 120 pt mascot, the name, 16 shapes in 8 columns, the 15
// colours, Create), then the two ways to set up with help (Guided with my
// bot, I'll fill it in myself) and the other starts. The window has focus
// as the desktop's dialog does: its accent ring.
//
// Guided and Manual open the wizard (BotWizardPresenter) in that mode; the
// templates and imports open Create New Bot's own flows.
import SwiftUI
import CompanionCore

struct DesktopNewBotModal: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let close: () -> Void
    let created: (Bot) -> Void

    @State private var name = ""
    @State private var color = "green"
    @State private var shape: MascotShape = .circle
    @State private var busy = false
    @State private var error: String?
    @State private var readOnly: String?
    @FocusState private var nameFocused: Bool

    /// `QUICK_SHAPES`: the soft bodies, objects left out, the first 16.
    static let shapes: [MascotShape] = Array(MascotShape.allCases.filter {
        ![.pad, .cup, .bulb, .say, .sprout, .tin, .tome, .ship].contains($0)
    }.prefix(16))

    /// `QUICK_COLORS`: the vivid row, then four clay guests not in it.
    static let colors = ["red", "coral", "orange", "amber", "yellow", "green", "teal", "cyan", "blue", "purple", "pink", "ink", "brown", "tomato", "tangerine"]

    private var canCreate: Bool { !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !busy }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.black.opacity(0.5)
                    .contentShape(Rectangle())
                    .onTapGesture(perform: close)
                    .accessibilityHidden(true)
                VStack(spacing: 0) {
                    header
                    ScrollView {
                        VStack(spacing: 0) {
                            if let readOnly {
                                Text(verbatim: readOnly)
                                    .font(theme.font(13)).lineSpacing(4)
                                    .foregroundStyle(theme.inkSecondary)
                                    .padding(.horizontal, 16).padding(.vertical, 12)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(theme.raised.opacity(0.6), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
                                    .padding(.horizontal, 32).padding(.top, 24)
                            } else {
                                if let error {
                                    Text(verbatim: error)
                                        .font(theme.font(13)).foregroundStyle(theme.danger)
                                        .padding(.horizontal, 12).padding(.vertical, 8)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .background(theme.danger.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                                        .padding(.horizontal, 32).padding(.bottom, 8)
                                }
                                quickCreate
                                modeChoice
                            }
                        }
                    }
                }
                .frame(width: min(760, geometry.size.width - 48))
                .frame(maxHeight: geometry.size.height - 48)
                .background(theme.panel)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
                // the dialog has focus (`tabIndex={-1}`, focused on open)
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(theme.focus, lineWidth: 1.5))
                .shadow(color: .black.opacity(0.45), radius: 40, y: 30)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .ignoresSafeArea()
        .background(DesktopEscapeKey(action: close))
        .task {
            readOnly = NewBotRules.readOnly(await session.configStatus()) ? String(localized: "Your administrator lets you use shared bots only.") : nil
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-new-bot")
    }

    private var header: some View {
        HStack(spacing: 12) {
            PulsatrixLogoMark(size: 36)
                .frame(width: 36, height: 36)
            HStack(spacing: 8) {
                DesktopIconView(icon: .bot, size: 16).foregroundStyle(theme.inkSecondary)
                Text("Create a bot")
                    .font(theme.font(18, .semibold))
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                    .accessibilityAddTraits(.isHeader)
            }
            Spacer(minLength: 0)
            Button(action: close) {
                Text("Later").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("desktop-new-bot.later")
        }
        .padding(.horizontal, 32)
        .padding(.top, 28)
        .padding(.bottom, 12)
    }

    // MARK: Quick create (QuickCreate.tsx)

    private var quickCreate: some View {
        VStack(spacing: 24) {
            ShapeMascotView(shape: shape, skin: .plain, color: color, size: 120)
                .frame(width: 120, height: 120)
                .accessibilityLabel(Text(verbatim: name.trimmingCharacters(in: .whitespaces).isEmpty ? String(localized: "New bot") : name))
            TextField(String(localized: "Name your bot"), text: $name)
                .font(theme.font(16, .medium))
                .multilineTextAlignment(.center)
                .foregroundStyle(theme.ink)
                .focused($nameFocused)
                .submitLabel(.done)
                .onSubmit(create)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(nameFocused ? theme.accentBorder : theme.hairline.opacity(0.5), lineWidth: 1))
                .frame(maxWidth: 384)
                .accessibilityIdentifier("desktop-new-bot.name")
            VStack(spacing: 12) {
                Text("Shape").font(theme.font(12, .medium)).foregroundStyle(theme.inkSecondary)
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(40), spacing: 8), count: 8), spacing: 8) {
                    ForEach(Self.shapes, id: \.self) { id in
                        let on = shape == id
                        Button { shape = id } label: {
                            ShapeMascotView(shape: id, skin: .plain, color: color, size: 28)
                                .frame(width: 28, height: 28)
                                .frame(width: 40, height: 40)
                                .background(on ? theme.accent.opacity(0.1) : Color.clear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(on ? theme.accent : theme.hairline.opacity(0.4), lineWidth: 1))
                                .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).strokeBorder(on ? theme.accent.opacity(0.4) : Color.clear, lineWidth: 2).padding(-2))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(verbatim: id.rawValue))
                        .accessibilityAddTraits(on ? .isSelected : [])
                        .accessibilityIdentifier("desktop-new-bot.shape.\(id.rawValue)")
                    }
                }
            }
            .frame(maxWidth: 448)
            VStack(spacing: 12) {
                Text("Color").font(theme.font(12, .medium)).foregroundStyle(theme.inkSecondary)
                DesktopFlowLayout(spacing: 8) {
                    ForEach(Self.colors, id: \.self) { id in
                        let on = color == id
                        Button { color = id } label: {
                            Circle().fill(MausPalette.color(id))
                                .frame(width: 24, height: 24)
                                .padding(2)
                                .overlay(Circle().strokeBorder(on ? theme.ink : Color.clear, lineWidth: 2))
                                .frame(width: 28, height: 28)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(verbatim: id))
                        .accessibilityAddTraits(on ? .isSelected : [])
                        .accessibilityIdentifier("desktop-new-bot.color.\(id)")
                    }
                }
                .frame(maxWidth: 448)
            }
            Button(action: create) {
                HStack(spacing: 6) {
                    if busy { ProgressView().controlSize(.small).tint(theme.accentInk) }
                    Text(busy ? "Creating…" : "Create")
                }
                .font(theme.font(15, .medium))
                .foregroundStyle(canCreate || busy ? theme.accentInk : theme.ink.opacity(0.85))
                .frame(maxWidth: 384)
                .padding(.vertical, 10)
                // disabled: the desktop's 40 % button reads as a grey bar
                .background(canCreate || busy ? theme.accent : theme.ink.opacity(0.16), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!canCreate)
            .padding(.top, 4)
            .accessibilityIdentifier("desktop-new-bot.create")
            Text("Or set up with help below.")
                .font(theme.font(12.5))
                .foregroundStyle(theme.inkSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 384)
                .padding(.top, 8)
        }
        .padding(.horizontal, 32)
        .padding(.top, 8)
        .padding(.bottom, 32)
        .frame(maxWidth: .infinity)
    }

    // MARK: The ways to set up (ModeChoice)

    private var modeChoice: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("How do you want to set up your new bot? You can switch at any time without losing anything.")
                .font(theme.font(13.5)).lineSpacing(5)
                .foregroundStyle(theme.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .top, spacing: 12) {
                modeCard(icon: "bubble.left.and.bubble.right", title: "Guided with my bot",
                         body: guideBody, id: "guided") {
                    close()
                    BotWizardPresenter.shared.open(startMode: .guided)
                }
                modeCard(icon: "list.clipboard", title: "I'll fill it in myself",
                         body: Text("The same steps as a form, page by page, with suggestions ready to pick."), id: "manual") {
                    close()
                    BotWizardPresenter.shared.open(startMode: .manual)
                }
            }
            Text("Same draft in both modes: switch from the top of the wizard whenever you like.")
                .font(theme.font(12))
                .foregroundStyle(theme.inkSecondary)
        }
        .padding(.horizontal, 32)
        .padding(.bottom, 28)
    }

    /// `botWizard.mode.guided.body` names the guide: the person's Bot
    /// designer, else their Primary Bot, else another bot.
    private var guideBody: Text {
        if let guide = BotWizardRules.guide(bots: session.state.bots, draftBotId: nil) {
            return Text("\(guide.name) asks you the questions and fills in each step live, right beside the conversation. You can correct any field.")
        }
        return Text("Your Bot designer asks you the questions and fills in each step live. It is created for you, as your own bot, the moment you choose this.")
    }

    private func modeCard(icon: String, title: LocalizedStringKey, body: Text, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 18))
                    .foregroundStyle(theme.accent)
                    .frame(width: 44, height: 44)
                    .background(theme.accent.opacity(0.15), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                Text(title).font(theme.font(16, .semibold)).foregroundStyle(theme.ink)
                body.font(theme.font(13)).lineSpacing(5).foregroundStyle(theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(20)
            .frame(maxWidth: .infinity, minHeight: 180, alignment: .topLeading)
            .background(theme.elevated, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("desktop-new-bot.mode.\(id)")
    }

    private func create() {
        guard canCreate else { return }
        busy = true
        error = nil
        let look = MascotLook(character: .shape, shape: shape, skins: MascotLook.Skins(shape: .plain))
        let request = NewBotDraft(name: name.trimmingCharacters(in: .whitespacesAndNewlines), color: color, look: look, skin: .none)
        Task {
            let bot = await session.createBot(request)
            busy = false
            if let bot { created(bot) } else { error = session.actionError }
        }
    }
}

/// A wrapping row (the desktop's `flex flex-wrap justify-center`).
struct DesktopFlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = rows(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(width: bounds.width, subviews: subviews) {
            var x = bounds.minX + (bounds.width - row.width) / 2
            for index in row.items {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private func rows(width: CGFloat, subviews: Subviews) -> [(items: [Int], width: CGFloat, height: CGFloat)] {
        var rows: [(items: [Int], width: CGFloat, height: CGFloat)] = []
        var current: (items: [Int], width: CGFloat, height: CGFloat) = ([], 0, 0)
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let next = current.items.isEmpty ? size.width : current.width + spacing + size.width
            if next > width, !current.items.isEmpty {
                rows.append(current)
                current = ([index], size.width, size.height)
            } else {
                current = (current.items + [index], next, max(current.height, size.height))
            }
        }
        if !current.items.isEmpty { rows.append(current) }
        return rows
    }
}
