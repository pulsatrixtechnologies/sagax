// The composer's "+" sheet and its action list: the one registry new chat
// actions are added to, drawn exactly as before the split. WP3 adds Paste,
// the real "/" menu, Compact and a room's Interrupt.
import SwiftUI
import CompanionCore
import UIKit

extension ChatView {
    // MARK: - The + sheet

    /// What the composer's + opens: a glass sheet of the things you can do
    /// here, each with a line saying what it does. Rises above the composer;
    /// tapping anywhere else, or the × the + became, puts it away.
    @ViewBuilder
    var plusSheet: some View {
        if showingPlus {
            ZStack(alignment: .bottom) {
                Color.black.opacity(Theme.palette.isDark ? 0.35 : 0.2)
                    .ignoresSafeArea()
                    .onTapGesture { withAnimation(.snappy(duration: 0.28)) { showingPlus = false } }

                // Every action fits on a tall phone; on a shorter one (or with
                // larger text) the list scrolls instead of leaving the screen.
                // Grok Bot's composer menu (2026-11-01): a compact glass
                // popover over the +, one line per action; what each does is
                // its VoiceOver hint.
                ViewThatFits(in: .vertical) {
                    plusActionList
                    ScrollView(showsIndicators: false) { plusActionList }
                }
                .padding(.vertical, 6)
                .frame(width: PlusMenuMetrics.width)
                .glassSheet(cornerRadius: PlusMenuMetrics.radius)
                .frame(maxWidth: CompanionLayout.chatWidth, alignment: .leading)
                .padding(.horizontal, Theme.Chat.composerMargin)
                // above the composer row (30 pt bottom inset, 44 pt tall)
                .padding(.bottom, Theme.Chat.composerBottom + Theme.Metric.glassLarge + 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .transition(.scale(scale: 0.6, anchor: .bottomLeading).combined(with: .opacity))
            }
            .transition(.opacity)
        }
    }

    var plusActionList: some View {
        let actions = plusActions
        return VStack(spacing: 0) {
            ForEach(Array(actions.enumerated()), id: \.element.id) { index, action in
                if index > 0, PlusMenuMetrics.attachmentIds.contains(actions[index - 1].id), !PlusMenuMetrics.attachmentIds.contains(action.id) {
                    Rectangle()
                        .fill(Theme.textPrimary.opacity(0.12))
                        .frame(height: 0.5)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 4)
                }
                Button {
                    withAnimation(.snappy(duration: 0.28)) { showingPlus = false }
                    action.run()
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: action.systemImage)
                            .font(.system(size: 15, weight: .regular))
                            .foregroundStyle(action.destructive ? Theme.destructiveMenu : Theme.textSecondary)
                            .frame(width: 22)
                        Text(action.title)
                            .font(.system(size: 15))
                            .foregroundStyle(action.destructive ? Theme.destructiveMenu : Theme.textPrimary)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 16)
                    .frame(height: PlusMenuMetrics.row)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(action.disabled)
                .opacity(action.disabled ? 0.45 : 1)
                .accessibilityHint(Text(action.subtitle))
                .accessibilityIdentifier("plus-\(action.id)")
            }
        }
    }

    enum PlusMenuMetrics {
        static let width: CGFloat = 268
        static let radius: CGFloat = 22
        static let row: CGFloat = 42
        /// The attachment group, set apart from the rest by a line.
        static let attachmentIds: Set<String> = ["photos", "camera", "files", "voiceNote", "paste"]
    }

    struct PlusAction: Identifiable {
        let id: String
        let systemImage: String
        let title: LocalizedStringKey
        let subtitle: LocalizedStringKey
        var destructive = false
        var disabled = false
        let run: () -> Void
    }

    var plusActions: [PlusAction] {
        let canAddAttachment = attachments.count < AttachmentPolicy.maximumItems
            && !preparingAttachments && !sendingMessage
        var out: [PlusAction] = [
            PlusAction(
                id: "photos", systemImage: "photo.on.rectangle", title: "Photo Library",
                subtitle: "Add a photo or video to this message", disabled: !canAddAttachment
            ) { showingPhotoPicker = true },
        ]
        // Take Photo (the reference design's composer menu), where the phone has a camera
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            out.append(PlusAction(
                id: "camera", systemImage: "camera", title: "Take Photo",
                subtitle: "Take a photo with the camera", disabled: !canAddAttachment
            ) { showingCamera = true })
        }
        out += [
            PlusAction(
                id: "files", systemImage: "paperclip", title: "Choose File",
                subtitle: "Add a document, audio, or video from Files", disabled: !canAddAttachment
            ) { showingFileImporter = true },
        ]
        out.append(PlusAction(
            id: "voiceNote", systemImage: "waveform",
            title: LocalizedStringKey(String(localized: "Record a voice note")),
            subtitle: LocalizedStringKey(String(localized: "Or touch and hold the microphone")),
            disabled: !canAddAttachment || voiceNote.isActive
        ) { startVoiceNote(mode: .toggle) })
        if session.surfaceGate.allows(.pasteAttachment), UIPasteboard.general.hasImages || UIPasteboard.general.hasStrings {
            out.append(PlusAction(
                id: "paste", systemImage: "doc.on.clipboard", title: "Paste",
                subtitle: "Add the copied image or text", disabled: !canAddAttachment
            ) { pasteFromClipboard() })
        }
        out.append(PlusAction(
            id: "commands", systemImage: "command",
            title: LocalizedStringKey(String(localized: "Slash commands")),
            subtitle: LocalizedStringKey(String(localized: "Engine commands, /learn, /setup and more")),
            disabled: preparingAttachments || sendingMessage
        ) {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) { openCommandMenu() }
        })
        if session.surfaceGate.allows(.findInConversation) {
            out.append(PlusAction(
                id: "find", systemImage: "magnifyingglass",
                title: LocalizedStringKey(String(localized: "Find in conversation")),
                subtitle: LocalizedStringKey(String(localized: "Search this thread's messages"))
            ) { openFind() })
        }
        if case let .bot(bot) = current {
            // the phone's "+" door keeps the thread entries while threads are
            // on, wherever they are listed (the header's name menu follows
            // Threads location, #210)
            if threadPrefs.threads.allows(.newThread) {
                out.append(PlusAction(
                    id: "task", systemImage: "plus.square.on.square", title: "New thread",
                    subtitle: "Start a fresh thread with \(bot.name)"
                ) { Task {
                    if let created = await session.createTask(for: bot, title: nil) {
                        selectedThreadId = created.threadId
                    }
                } })
                out.append(PlusAction(
                    id: "tasks", systemImage: "square.stack", title: "Threads",
                    subtitle: "Switch, rename or remove one"
                ) { showingTasks = true })
            }
            out.append(PlusAction(
                id: "settings", systemImage: "gearshape", title: "Bot settings",
                subtitle: "Model, profile, voice and notifications"
            ) { openPanel(.plusSettings) })
            if session.surfaceGate.allows(.compactConversation) {
                out.append(PlusAction(
                    id: "compact", systemImage: "rectangle.compress.vertical", title: "Compact conversation",
                    subtitle: "Summarize the context to free room", disabled: current.busy || hasPendingApproval
                ) { Task {
                    if await session.compact(bot: bot) { Haptics.impact(.light) }
                } })
            }
            out.append(PlusAction(
                id: "computer", systemImage: "display", title: "Watch computer",
                subtitle: "Live view of what \(bot.name) is doing"
            ) { openPanel(.plusComputer) })
            out.append(PlusAction(
                id: "voice", systemImage: "waveform",
                title: LocalizedStringKey(String(localized: "Voice mode")),
                subtitle: LocalizedStringKey(String(localized: "Talk to \(bot.name) hands-free"))
            ) { startVoiceMode() })
        }
        if case let .room(room) = current, room.dm != true {
            // a group's thread entries follow Show threads too (TaskPicker.tsx)
            if threadPrefs.threads.allows(.roomThreads) {
                out.append(PlusAction(
                    id: "task", systemImage: "plus.square.on.square", title: "New thread",
                    subtitle: "Start a fresh conversation in \(room.name)",
                    disabled: current.busy || hasPendingApproval
                ) { Task { await session.createTask(for: room, title: nil) } })
                out.append(PlusAction(
                    id: "tasks", systemImage: "square.stack", title: "Threads",
                    subtitle: "Switch, rename or remove one"
                ) { showingTasks = true })
            }
            out.append(PlusAction(
                id: "room-info", systemImage: "info.circle",
                title: LocalizedStringKey(String(localized: "Group info")),
                subtitle: LocalizedStringKey(String(localized: "Members, instructions, memory"))
            ) { showingRoomInfo = true })
        }
        out.append(PlusAction(
            id: "share", systemImage: "doc.plaintext", title: "Share transcript",
            subtitle: "This thread as Markdown"
        ) {
            Task {
                if let url = await session.export(threadId: current.threadId, format: "markdown") {
                    shareFile = ShareFile(url: url)
                }
            }
        })
        out.append(PlusAction(
            id: "share-json", systemImage: "curlybraces", title: "Share as JSON",
            subtitle: "Structured transcript data"
        ) {
            Task {
                if let url = await session.export(threadId: current.threadId, format: "json") {
                    shareFile = ShareFile(url: url)
                }
            }
        })
        if current.busy, case let .bot(bot) = current {
            out.append(PlusAction(
                id: "stop", systemImage: "stop.fill", title: "Interrupt",
                subtitle: "Stop the current turn", destructive: true
            ) { Task { await session.interrupt(bot: bot) } })
        }
        if current.busy, case let .room(room) = current, session.surfaceGate.allows(.roomInterrupt) {
            let thread = threadId
            out.append(PlusAction(
                id: "stop", systemImage: "stop.fill", title: "Interrupt",
                subtitle: "Stop the current turn", destructive: true
            ) { Task { await session.interrupt(room: room, threadId: thread) } })
        }
        return out
    }
}
