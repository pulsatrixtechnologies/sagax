// The strips above the composer field: failed sends, held sends, progress,
// errors, the "/" menu, "@"/"#" suggestions or quick replies, the pending
// attachments and pastes, the busy-send choice. One seam for the strips the
// parity packages add (reply quote, find bar, suggestions: WP1, WP3, WP4;
// WP4's citation chips sit above the pastes).
import SwiftUI
import CompanionCore

extension ChatView {
    /// What the composer says about the ears or the voice (ComposerAccessories).
    var composerVoiceNotice: String? {
        if dictation.isListening || dictation.isStarting, let reason = dictation.appleReason {
            return String(localized: "\(reason) Dictation hears with Apple on this iPhone.")
        }
        if let line = dictation.keyNotice { return line }
        return speaker.notice
    }

    @ViewBuilder
    var composerAccessories: some View {
        runCard

        ForEach(power.failedSends(threadId)) { failure in
            FailedSendBanner(
                failure: failure,
                retrying: power.retrying.contains(failure.id),
                retry: { retry(failure) },
                dismiss: { withAnimation(.snappy(duration: 0.2)) { power.forget(failure) } }
            )
            .transition(.slideUp(reduce: reduceMotion))
        }

        if !heldSends.isEmpty {
            QueuedSendList(
                sends: heldSends,
                isRoom: !current.isBot,
                steering: power.steering.contains(threadId),
                steerInterrupts: canSteerLive == false,
                steer: canSteerHeld ? { steerHeld() } : nil,
                edit: editQueued
            ) { send in
                Task { await session.cancelQueued(send, threadId: threadId, in: current) }
            }
            .transition(.slideUp(reduce: reduceMotion))
        }

        if preparingAttachments || sendingMessage {
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text(preparingAttachments ? "Preparing attachments…" : "Sending…")
                    .font(.system(size: 13, weight: .medium))
            }
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
            .accessibilityElement(children: .combine)
        }

        if let openingFileName {
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text("Opening \(openingFileName)…")
                    .font(.system(size: 13, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
            .accessibilityElement(children: .combine)
        }

        if let error = fileOpenError ?? attachmentError {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(Theme.warning)
                Text(error)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                Button("Dismiss") {
                    fileOpenError = nil
                    attachmentError = nil
                }
                .font(.system(size: 13, weight: .semibold))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(Theme.warning.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
            .accessibilityElement(children: .combine)
        }

        if let error = dictation.error {
            Text(error)
                .font(.system(size: 13))
                .foregroundStyle(Theme.warning)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 4)
        }
        // Apple hears although xAI was wanted: said while listening, never
        // a silent fallback; a key that gave way to another: said once;
        // a reply read by another voice than xAI's: its reason
        if let line = composerVoiceNotice {
            Text(line)
                .font(.system(size: 12.5))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 4)
                .accessibilityIdentifier("composer-voice-notice")
        }

        let menuItems = desktopChat == nil ? slashMenuItems : []
        let suggestions = desktopChat == nil ? suggestionItems : []
        if desktopChat != nil {
            // the desktop pill floats these (desktopComposerPopup)
        } else if slashContext != nil, !menuItems.isEmpty || power.loadingCommands {
            ComposerCommandMenuView(
                items: menuItems,
                loading: power.loadingCommands,
                accent: MausPalette.color(current.color),
                refresh: commandTargets.contains { power.commands(botId: $0.member.id, threadId: threadId, groupId: current.isBot ? nil : current.id)?.available == true }
                    ? { Task { await loadCommands(refresh: true) } } : nil,
                close: closeCommandMenu,
                pick: pickCommand
            )
            .transition(.slideUp(reduce: reduceMotion))
        } else if !suggestions.isEmpty {
            SuggestionStrip(items: suggestions, edgeInset: composerStripBleed + 4, pick: pickSuggestion)
                .composerStripBleed(composerStripBleed)
                .transition(.opacity)
        } else if composerFocused && draft.isEmpty && attachments.isEmpty && !current.busy
                    && !hasPendingApproval && !storedChips.isEmpty {
            // Quick replies while the keyboard is up: the resting
            // screen is the reference's bare composer.
            // The first chip on the "+" edge, not 14 pt inside it.
            PredictiveActionChipsView(
                chips: storedChips,
                accentColor: MausPalette.color(current.color),
                edgeInset: desktopChat == nil ? composerStripBleed : 14
            ) { chip in
                submit(chip.prompt)
            }
            .composerStripBleed(composerStripBleed)
            .transition(.opacity)
        }

        // Quoted selections waiting for this send (CO8, WP4).
        let quoted = citations.citations(threadId)
        if !quoted.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(quoted) { citation in
                        let thread = threadId
                        CitationChip(
                            citation: citation,
                            onChange: { citations.replace($0, threadId: thread) },
                            onRemove: {
                                guard !sendingMessage else { return }
                                citations.remove(citation.id, threadId: thread)
                            }
                        )
                    }
                }
                .padding(.horizontal, composerStripBleed + 2)
            }
            .composerStripBleed(composerStripBleed)
            .scrollClipDisabledCompat()
            .accessibilityIdentifier("composer-citations")
            .transition(.slideUp(reduce: reduceMotion))
        }

        let pastes = power.pastes(threadId)
        if !pastes.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 8) {
                    ForEach(pastes) { paste in
                        PastedTextChip(paste: paste, display: { displayPaste(paste) }) {
                            guard !sendingMessage else { return }
                            power.remove(paste, threadId: threadId)
                        }
                    }
                }
                .padding(.horizontal, composerStripBleed + 2)
            }
            .composerStripBleed(composerStripBleed)
            .scrollClipDisabledCompat()
            .transition(.slideUp(reduce: reduceMotion))
        }

        if !attachments.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(attachments) { attachment in
                        PendingAttachmentChip(attachment: attachment, uploadState: session.attachmentUploadState(attachment.id), retry: {
                            session.startAttachmentUpload(attachment, retry: true)
                        }) {
                            guard !sendingMessage else { return }
                            session.removeAttachmentUpload(attachment)
                            attachments.removeAll { $0.id == attachment.id }
                            for failure in power.failedSends(threadId) where failure.attachments.contains(where: { $0.id == attachment.id }) {
                                power.forget(failure)
                            }
                            attachmentError = nil
                        }
                    }
                }
                .padding(.horizontal, composerStripBleed + 2)
            }
            .composerStripBleed(composerStripBleed)
            .scrollClipDisabledCompat()
            .transition(.slideUp(reduce: reduceMotion))
        }

        approvalDock

        replyStrip

        // The bot cannot answer now: why, and the one thing to do.
        sendBlockLine
    }

    /// How far the phone composer's scrolling strips reach past its margin:
    /// all the way back to the edge, so a row of chips scrolls edge to edge
    /// instead of being cut 12 pt short of it. The iPad pill keeps its own
    /// insets (0: no bleed).
    var composerStripBleed: CGFloat {
        desktopChat == nil ? Theme.Chat.composerMargin : 0
    }
}

extension View {
    /// Widens a horizontal scroll strip past the composer's side margin by
    /// `bleed` on both sides; the strip pads its content by the same amount,
    /// so its first item still lines up with the bar.
    func composerStripBleed(_ bleed: CGFloat) -> some View {
        padding(.horizontal, -bleed)
    }
}
