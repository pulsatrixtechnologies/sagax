// The composer's "/" menu (CO9, CO10, CO24), drawn above the field the way
// the desktop's ComposerCommandMenu.tsx is: Sagax's own commands, then the
// engine's (Claude Code, Codex) grouped Engine, Plugins, MCP (in a room:
// under each bot's name), each with its argument hint. What the chat cannot
// run stays listed, dimmed, with its reason. Layout-agnostic: the iPhone
// composer stacks it above the field; the iPad pill can float it.
import SwiftUI
import CompanionCore

struct ComposerCommandMenuView: View {
    @Environment(\.themePalette) var themePalette
    let items: [ComposerMenuItem]
    let loading: Bool
    let accent: Color
    /// Read the engine's list again (shown once a list was read).
    let refresh: (() -> Void)?
    let close: () -> Void
    let pick: (ComposerMenuItem) -> Void
    /// iPad desktop shell: ComposerCommandMenu.tsx's panel (composer fill,
    /// hairline ring at 40 %, radius 12, 416 wide, at most 320 tall: a
    /// 37 pt raised header, 27 pt group headings, 53 pt rows).
    @Environment(\.desktopChatText) private var desktop

    /// The footer's 1 pt rule and its 6 + 16.5 + 6 line.
    static let footerHeight: CGFloat = 1 + 28.5

    private func startsSection(_ index: Int) -> Bool {
        index == 0 || items[index - 1].section != items[index].section
    }

    /// The desktop list's own height (its rows and headings), so the panel
    /// is as tall as what it lists, up to the 320 pt cap less the header.
    private var desktopListHeight: CGFloat {
        let headings = items.indices.filter(startsSection).count
        return min(CGFloat(headings) * 27 + CGFloat(items.count) * 53, 320 - 37 - Self.footerHeight)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Rectangle().fill(desktop.map { $0.hairline.opacity(0.2) } ?? Theme.hairline).frame(height: desktop == nil ? 0.5 : 1)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        if startsSection(index) {
                            sectionHeading(item)
                        }
                        row(item, highlighted: desktop != nil && index == 0)
                    }
                }
                .padding(.bottom, desktop == nil ? 4 : 0)
            }
            .frame(maxHeight: desktop == nil ? 264 : desktopListHeight)
            .frame(height: desktop == nil ? nil : desktopListHeight)
            if let desktop {
                // `sticky bottom-0 border-t px-3 py-1.5 text-[11px]`: "Esc to close"
                Rectangle().fill(desktop.hairline.opacity(0.2)).frame(height: 1)
                Text("Esc to close")
                    .font(desktop.font(11))
                    .foregroundStyle(desktop.inkTertiary)
                    .lineLimit(1)
                    .padding(.horizontal, 12)
                    .frame(maxWidth: .infinity, minHeight: Self.footerHeight - 1, alignment: .leading)
                    .background(desktop.raised)
                    .accessibilityIdentifier("slash-menu-esc")
            }
        }
        .modifier(CommandMenuChrome(desktop: desktop))
        // "Esc to close": a hardware keyboard's Escape closes it
        .background {
            if desktop != nil {
                Button("Close commands", action: close)
                    .keyboardShortcut(.escape, modifiers: [])
                    .opacity(0)
                    .accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Composer commands")
        .accessibilityIdentifier("slash-menu")
    }

    @ViewBuilder
    private var header: some View {
        if let desktop {
            HStack(spacing: 8) {
                Text("Commands")
                    .textCase(.uppercase)
                    .font(desktop.font(10, .semibold))
                    .tracking(0.8)
                    .foregroundStyle(desktop.inkSecondary)
                Spacer(minLength: 4)
                if loading {
                    Text("Loading engine commands…")
                        .font(desktop.font(11))
                        .foregroundStyle(desktop.inkTertiary)
                        .lineLimit(1)
                }
                if let refresh {
                    Button(action: refresh) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(desktop.inkSecondary)
                            .frame(width: 20, height: 20)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Refresh engine commands")
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(desktop.raised)
        } else {
            phoneHeader
        }
    }

    private var phoneHeader: some View {
        HStack(spacing: 8) {
            Text("Commands")
                .textCase(.uppercase)
                .font(.system(size: 10.5, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 4)
            if loading {
                Text("Loading engine commands…")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textTertiary)
                    .lineLimit(1)
            }
            if let refresh {
                Button(action: refresh) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(width: 26, height: 26)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Refresh engine commands")
            }
            Button(action: close) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textTertiary)
                    .frame(width: 26, height: 26)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close commands")
            .accessibilityIdentifier("slash-menu-close")
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func sectionHeading(_ item: ComposerMenuItem) -> some View {
        Group {
            if let bot = item.bot {
                Text(verbatim: bot.name)
            } else {
                Text(Self.groupTitle(item.group))
            }
        }
        .textCase(.uppercase)
        .font(desktop?.font(10, .semibold) ?? .system(size: 10, weight: .semibold))
        .tracking(0.8)
        .foregroundStyle(desktop?.inkTertiary ?? Theme.textTertiary)
        .lineLimit(1)
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, desktop == nil ? 2 : 4)
        .frame(height: desktop == nil ? nil : 27, alignment: .bottomLeading)
    }

    @ViewBuilder
    private func row(_ item: ComposerMenuItem, highlighted: Bool) -> some View {
        if let desktop {
            desktopRow(item, desktop: desktop, highlighted: highlighted)
        } else {
            phoneRow(item)
        }
    }

    private func desktopRow(_ item: ComposerMenuItem, desktop: DesktopTheme, highlighted: Bool) -> some View {
        let reason = item.unavailable.map(Self.reason)
        return Button {
            guard item.insertion != nil else { return }
            pick(item)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: Self.icon(item))
                    .font(.system(size: 14, weight: .regular))
                    .foregroundStyle(accent)
                    .frame(width: 32, height: 32)
                    .background(accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(verbatim: item.label)
                            .font(desktop.font(14, .medium))
                            .foregroundStyle(accent)
                            .frame(minHeight: 21)
                        if let hint = item.argumentHint {
                            Text(verbatim: hint)
                                .font(Theme.mono(11))
                                .foregroundStyle(desktop.inkTertiary)
                        }
                    }
                    .lineLimit(1)
                    Group {
                        if let reason { Text(reason) } else { Text(verbatim: item.description) }
                    }
                    .font(desktop.font(12))
                    .foregroundStyle(desktop.inkSecondary)
                    .lineLimit(1)
                    .frame(minHeight: 16)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(height: 53)
            .background(highlighted ? desktop.raisedHover : .clear)
            .contentShape(Rectangle())
            .opacity(reason == nil ? 1 : 0.55)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("slash-\(item.label)")
    }

    private func phoneRow(_ item: ComposerMenuItem) -> some View {
        let reason = item.unavailable.map(Self.reason)
        return Button {
            guard item.insertion != nil else { return }
            Haptics.selection()
            pick(item)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: Self.icon(item))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(accent)
                    .frame(width: 30, height: 30)
                    .background(accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(verbatim: item.label)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(accent)
                            .lineLimit(1)
                        if let hint = item.argumentHint {
                            Text(verbatim: hint)
                                .font(Theme.mono(11))
                                .foregroundStyle(Theme.textTertiary)
                                .lineLimit(1)
                        }
                    }
                    Group {
                        if let reason { Text(reason) } else { Text(verbatim: item.description) }
                    }
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
            .opacity(reason == nil ? 1 : 0.55)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("slash-\(item.label)")
        .accessibilityHint(reason.map { Text($0) } ?? Text(verbatim: ""))
    }

    static func icon(_ item: ComposerMenuItem) -> String {
        switch item.kind {
        // ComposerCommandMenu.tsx ItemIcon: Target, Wand2, Repeat, BookOpen
        case let .sagax(command):
            switch command {
            case .goal: return "target"
            case .setup: return "wand.and.stars"
            case .loop, .loopStatus, .loopStop: return "repeat"
            case .learn: return "book"
            }
        case .skill: return "sparkles"
        case .engine:
            switch item.group {
            case .plugins: return "puzzlepiece"
            case .mcp: return "powerplug"
            default: return "terminal"
            }
        }
    }

    static func groupTitle(_ group: ComposerMenuItem.Group) -> LocalizedStringKey {
        switch group {
        case .goal: return "Goal"
        case .sagax: return "Sagax"
        case .skills: return "Skills"
        case .engine: return "Engine"
        case .plugins: return "Plugins"
        case .mcp: return "MCP"
        }
    }

    static func reason(_ unavailable: HarnessCommandUnavailable) -> LocalizedStringKey {
        switch unavailable {
        case .interactive: return "Needs the engine's own terminal, so it cannot run from the chat"
        case .managed: return "Managed by Sagax: model, effort, conversations, approvals and MCP servers have their own settings"
        }
    }

    /// The descriptions of Sagax's own commands (`composer.command.*Desc`,
    /// `composer.loop.sub.*`); a 1:1's /goal is the bot's own goal.
    static func description(_ command: SagaxSlashCommand, room: Bool) -> String {
        switch command {
        case .goal:
            return room ? String(localized: "Keep a team working until the goal is complete")
                : String(localized: "Give this bot a goal and let it work until the goal is done")
        case .learn: return String(localized: "Draft a reusable skill from this conversation")
        case .setup: return String(localized: "Have this bot interview you and set itself up")
        case .loop: return String(localized: "Repeat a prompt in this chat")
        case .loopStatus: return String(localized: "Show this bot's loops")
        case .loopStop: return String(localized: "Stop a loop")
        }
    }

    /// `composer.command.goalHint`, `composer.command.loopHint`.
    static func hint(_ command: SagaxSlashCommand) -> String? {
        switch command {
        case .goal: return String(localized: "<goal>")
        case .loop: return String(localized: "5m prompt")
        default: return nil
        }
    }
}

/// The menu's frame: the phone's raised card, or the desktop's panel.
private struct CommandMenuChrome: ViewModifier {
    @Environment(\.themePalette) var themePalette
    let desktop: DesktopTheme?

    func body(content: Content) -> some View {
        if let desktop {
            content
                .background(desktop.composer)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(desktop.hairline.opacity(0.4), lineWidth: 1))
                .shadow(color: .black.opacity(0.1), radius: 8, y: 6)
        } else {
            content
                .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.hairline, lineWidth: 0.8))
                .shadow(color: Color.black.opacity(Theme.palette.isDark ? 0.25 : 0.08), radius: 8, y: 3)
                .padding(.horizontal, 4)
        }
    }
}
