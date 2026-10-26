// The chat's top bar (reference 02): back, the name capsule and its menu,
// and the computer button. Split out of ChatView.swift so the iPhone and the
// iPad desktop layout share it.
import SwiftUI
import CompanionCore
import UIKit

extension ChatView {
    var mascotState: MausState { MausState.forChat(current, in: session.state) }

    var headerBar: some View {
        ZStack {
            HStack(spacing: 0) {
                // chevron ink 8.7 x 15.3 pt, optically centred at x 39.7
                GlassCircleButton(
                    systemImage: "chevron.left", accessibilityLabel: "Back",
                    glyphSize: 18, glyphOffset: CGSize(width: 0.85, height: -0.25)
                ) { dismiss() }
                    .chatGlassRim(Circle())
                    .overlay(alignment: .topTrailing) {
                        if unreadElsewhere > 0 {
                            Text(verbatim: "\(unreadElsewhere)")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Theme.accentInk)
                                .padding(.horizontal, 5)
                                .frame(minWidth: 18, minHeight: 18)
                                .background(Theme.unreadDot, in: Capsule())
                                .offset(x: 4, y: -4)
                                .allowsHitTesting(false)
                                .accessibilityLabel(Text(String(localized: "\(unreadElsewhere) unread elsewhere")))
                        }
                    }
                Spacer(minLength: 8)
                // Settings > Experimental's development context pods, while
                // the conversation looks like development work
                if devPodsAvailable {
                    DevPodsHeaderButton(active: showingDevPods) { openDevPods() }
                        .padding(.trailing, 8)
                        .transition(.opacity)
                }
                if let threads = headerThreadCount {
                    threadsButton(count: threads)
                        .padding(.trailing, 8)
                }
                chatMoreButton
            }
            ChatNameCapsule(chat: current, state: mascotState) { openProfile() }
                // narrower beside the dev pods or threads button, so they never meet
                .frame(maxWidth: devPodsAvailable || headerThreadCount != nil ? 170 : 230)
                .contextMenu { nameCapsuleMenu }
                .accessibilityLabel(Text(PeopleDirectory.shared.name(current, session: session)))
                // The thread is no longer drawn in the header; VoiceOver
                // (and the UI tests) still hear which one is open.
                .accessibilityValue(Text(current.supportsTasks ? current.threadTitle : current.subtitle))
                .accessibilityHint(Text(current.isBot
                    ? String(localized: "Opens the profile. Touch and hold for threads.")
                    : String(localized: "Opens the conversation options.")))
                .accessibilityIdentifier("chat-name")
        }
        .padding(.horizontal, Theme.Metric.screenEdge)
        .padding(.top, 6)
        .frame(maxWidth: CompanionLayout.headerWidth)
        .frame(maxWidth: .infinity)
    }

    /// The "..." at the top right (Grok Bot iOS 1.14): the profile, the
    /// computer (it had its own button before), the threads the name's
    /// long press offers, then sharing and the bot's id.
    /// A bot's threads, one touch away from its chat whatever Settings say
    /// (the desktop keeps its activity picker above the chat with threads
    /// hidden; JC 2026-10-19: a new thread, one the bot opened in parallel
    /// or a new topic, was announced but could not be reached). Nil below
    /// two threads: the chat on screen is then all there is.
    var headerThreadCount: Int? {
        guard case let .bot(bot) = current else { return nil }
        let live = session.state.bot(bot.id) ?? bot
        let count = live.threadGroups(queuedThreadIds: session.state.queuedThreadIds).reduce(0) { $0 + $1.tasks.count }
        return count >= 2 ? count : nil
    }

    /// Sibling threads that want a look: working, waiting on the person,
    /// unread, queued. Drawn as a dot on the threads button.
    var threadsNeedingAttention: Int {
        guard case let .bot(bot) = current else { return 0 }
        let live = session.state.bot(bot.id) ?? bot
        let queued = session.state.queuedThreadIds
        return (live.tasks ?? []).filter { task in
            task.threadId != threadId && !task.isHiddenFromPerson && (task.unread == true || task.busy == true
                || task.activity == "working" || task.activity == "waiting-on-you" || queued.contains(task.threadId))
        }.count
    }

    /// The threads button: the thread list (TaskManagerView), where one
    /// touch switches this chat.
    func threadsButton(count: Int) -> some View {
        let attention = threadsNeedingAttention
        return Button {
            Haptics.selection()
            showingTasks = true
        } label: {
            Image(systemName: "square.stack")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
                .frame(width: Theme.Metric.glassLarge, height: Theme.Metric.glassLarge)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .themeGlass(Circle())
        .chatGlassRim(Circle())
        .overlay(alignment: .topTrailing) {
            if attention > 0 {
                Circle()
                    .fill(Theme.unreadDot)
                    .frame(width: 10, height: 10)
                    .offset(x: -2, y: 2)
                    .allowsHitTesting(false)
            }
        }
        .accessibilityLabel(Text("All threads"))
        .accessibilityValue(Text(attention > 0
            ? String(localized: "\(count) threads, \(attention) with news")
            : String(localized: "\(count) threads")))
        .accessibilityIdentifier("chat-threads")
    }

    var chatMoreButton: some View {
        Menu {
            chatMoreItems
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
                .frame(width: Theme.Metric.glassLarge, height: Theme.Metric.glassLarge)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .themeGlass(Circle())
        .chatGlassRim(Circle())
        .simultaneousGesture(TapGesture().onEnded { Haptics.selection() })
        .accessibilityLabel(Text("More"))
        .accessibilityIdentifier("chat-more")
    }

    @ViewBuilder
    var chatMoreItems: some View {
        if case .bot = current {
            Button { openProfile() } label: {
                Label(String(localized: "View profile"), systemImage: "person.crop.circle")
            }
            .accessibilityIdentifier("chat-more.profile")
            Button { openPanel(.computerButton) } label: {
                Label(String(localized: "Watch computer"), systemImage: "display")
            }
            .accessibilityIdentifier("header-computer")
        }
        nameCapsuleMenu
        Divider()
        Button {
            Task {
                if let url = await session.export(threadId: current.threadId, format: "markdown") {
                    shareFile = ShareFile(url: url)
                }
            }
        } label: {
            Label(String(localized: "Share transcript"), systemImage: "square.and.arrow.up")
        }
        .accessibilityIdentifier("chat-more.share")
        if case let .bot(bot) = current {
            Button {
                UIPasteboard.general.string = bot.id
                Haptics.selection()
            } label: {
                Label(String(localized: "Copy ID"), systemImage: "doc.on.clipboard")
            }
            .accessibilityIdentifier("chat-more.copy-id")
        }
    }

    /// Touch and hold the name: threads and the profile.
    @ViewBuilder
    var nameCapsuleMenu: some View {
        // A bot's threads live here while Threads location is the chat
        // header (#143, #210); in sidebar mode they are under its home row
        // and the header offers none. Rooms are unchanged.
        if current.supportsTasks, !current.isBot || SidebarPrefsModel.shared.threadsPlacement.inHeader {
            Button { showingTasks = true } label: {
                Label(String(localized: "Threads"), systemImage: "square.stack")
            }
            if case let .bot(bot) = current {
                Button {
                    Task {
                        let choice = NewThreadChoice.ordinary(orgDefaultConfidential: session.confidentialThreadsByDefault)
                        if let created = await session.createTask(for: bot, title: nil, confidential: choice.confidential) {
                            selectedThreadId = created.threadId
                        }
                    }
                } label: {
                    Label(String(localized: "New thread"), systemImage: "plus.square.on.square")
                }
                Button {
                    Task {
                        if let created = await session.createTask(for: bot, title: nil, confidential: true) {
                            selectedThreadId = created.threadId
                        }
                    }
                } label: {
                    Label(String(localized: "New confidential thread"), systemImage: ConfidentialBanner.symbol)
                }
                .accessibilityIdentifier("new-confidential-thread")
            } else if case let .room(room) = current, room.peopleDm == true {
                // a person's conversation starts threads like a bot (#262)
                Button {
                    Task { _ = await session.createTask(for: room, title: nil) }
                } label: {
                    Label(String(localized: "New thread"), systemImage: "plus.square.on.square")
                }
            }
        }
        if case let .room(room) = current, room.peopleDm == true {
            // WP15 (RM21): a conversation with a person opens their sheet
            if let peer = PeopleDirectory.shared.peer(room, session: session) {
                Button { PeopleDirectory.shared.showPerson(peer.id) } label: {
                    Label(String(localized: "View profile"), systemImage: "person.crop.circle")
                }
            }
        } else if case let .room(room) = current, room.dm != true {
            Button { showingRoomInfo = true } label: {
                Label(String(localized: "Group info"), systemImage: "info.circle")
            }
        }
    }

    /// The name capsule opens the profile (rooms: their threads or the +
    /// sheet). `ChatProfileRoute` decides what the profile is and how it is
    /// presented.
    func openProfile() {
        // iPad desktop shell: the bot's profile is the docked panel.
        if let desktopChat, case .bot = current {
            desktopChat.showPanel(.details)
            return
        }
        guard case .bot = current else {
            // A conversation with a person opens their sheet (RM21), the
            // way the desktop's header name does.
            if case let .room(room) = current, room.peopleDm == true,
               let peer = PeopleDirectory.shared.peer(room, session: session) {
                PeopleDirectory.shared.showPerson(peer.id)
            // A team room opens its Room info (RM6); Threads is a row there.
            } else if case let .room(room) = current, room.dm != true {
                showingRoomInfo = true
            } else if current.supportsTasks {
                showingTasks = true
            } else {
                showingPlus = true
            }
            return
        }
        openPanel(.nameCapsule)
    }

    /// The bot panel on the door's tab: full screen on the phone, the docked
    /// panel in the iPad's desktop shell.
    func openPanel(_ door: BotPanelDoor) {
        guard case .bot = current else { return }
        if let desktopChat {
            desktopChat.showPanel(door.tab)
            return
        }
        panelTab = door.tab
        showingPanel = true
    }

    /// Voice mode: a live call with this bot or room (the desktop's call
    /// button in the composer). Pressed again on a call, it hangs up.
    func startVoiceMode() {
        dictation.stop()
        composerFocused = false
        let chat = current
        if call.isOnCall(chat) {
            call.end()
            return
        }
        Haptics.impact(.medium)
        Task { await call.start(chat, session: session) }
    }

    var callPillShown: Bool {
        call.isOnCall(current)
    }

    /// Who the bar calls: the bot, or the room with its members.
    private var callSubject: CallBarSubject {
        switch current {
        case let .bot(bot): .bot(bot)
        case let .room(room): .room(room, members: room.memberIds.compactMap { session.state.bot($0) })
        }
    }

    /// A call, with a bot or a room: the floating bar under the name, as on
    /// the desktop's bot call. It takes only its own row; the conversation
    /// stays on screen and its card (settings, transcript) lies over the thread.
    @ViewBuilder
    var callBar: some View {
        if callPillShown {
            CallBar(subject: callSubject, call: call, panel: $callPanel)
                .padding(.horizontal, CallBarMetrics.gutter)
                .padding(.top, Self.topBarHeight + confidentialBandInset + (pinnedPreview == nil ? 0 : Self.pinnedBannerHeight) + CallBarMetrics.top)
                .frame(maxWidth: .infinity)
                .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .top)))
        }
    }

}
