// The composer: held sends, the strips above the field, the field itself,
// and sending. Split out of ChatView.swift unchanged.
import SwiftUI
import CompanionCore
import UIKit

extension ChatView {
    /// Send the draft (or a quick reply's words). While a one-to-one
    /// conversation works, the send goes as `.auto`: the bot decides whether
    /// it joins the work, runs in parallel or waits (never asked since
    /// 2026-10-18). A failed send is kept above the field with Retry (WP3).
    func submit(_ explicitText: String? = nil) {
        // This also cancels an in-flight permission prompt before it can
        // open the microphone after the message has already been sent.
        dictation.stop()
        let draftAtSend = draft
        let text = (explicitText ?? draftAtSend).trimmingCharacters(in: .whitespacesAndNewlines)
        let outgoingAttachments = attachments
        let chatAtSend = current
        let pastesAtSend = explicitText == nil ? power.pastes(chatAtSend.threadId) : []
        // Quoted selections (CO8) go with the typed words, not a quick reply.
        let citationsAtSend = explicitText == nil ? citations.citations(chatAtSend.threadId) : []
        let replyAtSend = session.surfaceGate.allows(.replyQuote) ? replyTo : nil
        guard !text.isEmpty || !outgoingAttachments.isEmpty || !pastesAtSend.isEmpty || !citationsAtSend.isEmpty,
              !preparingAttachments,
              !sendingMessage,
              session.attachmentUploadsReady(outgoingAttachments)
        else { return }
        // The bot cannot answer now (SendState.swift): nothing goes out, the
        // draft stays, and the state is asked again.
        if activeSendBlock != nil {
            Haptics.selection()
            sendBlockTick += 1
            return
        }
        // The hidden composer line toggles Hibou 98 and is never sent, as on
        // the desktop (src/lib/retro98.ts).
        if outgoingAttachments.isEmpty, pastesAtSend.isEmpty, citationsAtSend.isEmpty, text.lowercased() == "/hibou98" {
            draft = ""
            Haptics.selection()
            ThemeStore.shared.toggleRetro(client: session.settingsClient)
            return
        }
        // A room's typed "/goal …" runs as a bounded team goal.
        var words = text
        var goal = false
        if case let .room(room) = chatAtSend, room.dm != true, let goalText = goalTextFromComposer(text) {
            guard !goalText.isEmpty || !outgoingAttachments.isEmpty || !pastesAtSend.isEmpty || !citationsAtSend.isEmpty else { return }
            words = goalText
            goal = true
        }
        // Resolvable "#Title" runs leave as canonical links, then the
        // pastes, then the citations (their blocks are never trimmed).
        let requestText = Citations.compose(PastedText.compose(
            ThreadRefs.serialize(words, threads: session.threadRefCandidates, currentBotId: chatAtSend.id),
            pastes: pastesAtSend
        ), citations: citationsAtSend)
        let busyMode: BusySendMode? = BusySendChoice.routesAuto(for: chatAtSend) && session.surfaceGate.allows(.busySendChoice) ? .auto : nil
        sendingMessage = true
        attachmentError = nil
        power.commandMenuForced = false
        showingPlus = false
        // A page open over this bot's conversation: the message is about it
        // (`dataContext.page`, shared/data-context.ts withPageContext).
        let pageAtSend = PageViewRules.pageContext(
            text: words, page: openPage, title: openPage?.title ?? "", version: openPage?.version,
            botId: chatAtSend.isBot ? chatAtSend.id : nil
        )
        let options = SendOptions(replyToId: replyAtSend?.id, busyMode: busyMode, goal: goal, page: pageAtSend)
        Task {
            let sent = await session.send(
                text: requestText,
                attachments: outgoingAttachments,
                to: chatAtSend,
                options: options
            )
            sendingMessage = false
            guard sent else {
                let failure = session.actionError ?? String(localized: "Couldn't send this message. Try again.")
                session.actionError = nil
                // Kept with Retry; the words also stay in the field, so
                // either sends them (the same send id: never twice).
                power.remember(FailedSend(
                    text: text, requestText: requestText, attachments: outgoingAttachments,
                    replyToId: replyAtSend?.id, busyMode: busyMode, goal: goal,
                    threadId: chatAtSend.threadId, error: failure
                ))
                return
            }
            // A send that went through settles an earlier failure of the
            // same words.
            for failed in power.failedSends(chatAtSend.threadId) where failed.requestText == requestText {
                power.forget(failed)
            }
            power.clearPastes(pastesAtSend.map(\.id), threadId: chatAtSend.threadId)
            citations.clear(citationsAtSend.map(\.id), threadId: chatAtSend.threadId)
            // The quote was sent: it leaves with the words, unless another
            // one was picked while the send was in flight.
            if threadId != chatAtSend.threadId {
                if let replyAtSend, threadDrafts[chatAtSend.threadId]?.replyTo?.id == replyAtSend.id {
                    threadDrafts[chatAtSend.threadId]?.replyTo = nil
                }
                if threadDrafts[chatAtSend.threadId]?.text == draftAtSend { threadDrafts[chatAtSend.threadId]?.text = "" }
                if threadDrafts[chatAtSend.threadId]?.attachments.map(\.id) == outgoingAttachments.map(\.id) {
                    threadDrafts[chatAtSend.threadId]?.attachments = []
                }
                return
            }
            // Compare with what was actually in the field at tap time, not
            // the sent text, so the send clears without erasing a newer edit.
            if draft == draftAtSend {
                draft = ""
            }
            if let replyAtSend, replyTo?.id == replyAtSend.id {
                replyTo = nil
            }
            if attachments.map(\.id) == outgoingAttachments.map(\.id) {
                attachments = []
            }
            SoundEffects.playSent()
            Haptics.impact(.medium)
        }
    }

    // MARK: - Composer

    /// Pull a held send back into the composer to tweak or extend it. The
    /// computer drops it from the queue first; only a confirmed removal hands
    /// the words back, so a send that already joined the turn is never resent.
    func editQueued(_ send: QueuedSend) {
        let targetThread = threadId
        let chat = current
        Task {
            guard await session.cancelQueued(send, threadId: targetThread, in: chat) else { return }
            if threadId == targetThread {
                power.pasteCheckSuppressed = true
                draft = send.editDraft(keeping: draft)
                composerFocused = true
            } else {
                // The person switched tasks while the cancel was in flight.
                var snapshot = threadDrafts[targetThread] ?? ComposerSnapshot()
                snapshot.text = send.editDraft(keeping: snapshot.text)
                threadDrafts[targetThread] = snapshot
            }
        }
    }

    /// One glass capsule, as in Grok Bot (2026-11-01): the + at its leading
    /// end, the field, then dictation and the white voice / send capsule.
    var composer: some View {
        VStack(spacing: 6) {
            composerAccessories

            HStack(alignment: .bottom, spacing: 0) {
                // "+" inside the capsule. Attachments, threads, slash
                // commands and the rest live in the sheet it opens.
                composerPlusButton
                    .padding(.leading, 6)

                // The field: "Message {name}", the mic (dictation) and the white
                // capsule (voice mode, or send once there is something to send).
                HStack(alignment: .bottom, spacing: 0) {
                    if voiceNote.isActive {
                        VoiceNoteRecordingStrip(
                            recorder: voiceNote,
                            tint: Theme.danger,
                            cancel: { voiceNote.cancel() },
                            send: { sendVoiceNote() }
                        )
                    } else {
                    TextField(
                        "",
                        text: draftBinding,
                        prompt: Text(composerPrompt).foregroundColor(Theme.composerPlaceholder),
                        axis: .vertical
                    )
                        .lineLimit(1...5)
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.textPrimary)
                        .padding(.leading, 4)
                        .padding(.top, 12.35)
                        .padding(.bottom, 13.65)
                        .focused($composerFocused)
                        .accessibilityIdentifier("message-input")
                        // Partial transcripts rebuild from a frozen base;
                        // prevent competing edits without dimming the text.
                        .allowsHitTesting(
                            !dictation.isListening && !dictation.isStarting && !dictation.isProcessing
                                && !preparingAttachments && !sendingMessage
                        )
                        // Not in an animated transaction: a keystroke must
                        // not animate every layout change it causes. The
                        // strips it shows or hides animate themselves.
                        .onValueChangePair(of: draft) { old, new in
                            draftChanged(from: old, to: new)
                        }
                        // The software keyboard's Return inserts a newline,
                        // like Messages; only the send button sends. A
                        // hardware Return still sends, Shift-Return breaks
                        // the line. onKeyPress never sees the software
                        // keyboard, so this cannot turn its Return into a send.
                        .onHardwareReturn { submit() }
                    }

                    // Tap: dictation, as before. Hold: a voice note that a
                    // release sends (slide left to cancel). Kept in place
                    // while recording so the press that started it can end it.
                    if !(voiceNote.isActive && voiceNote.mode == .toggle) {
                        let recording = voiceNote.isActive
                        MicGlyph()
                            .fill(dictation.isListening || recording ? Theme.danger : Theme.composerMic)
                            .frame(width: MicGlyph.size.width, height: MicGlyph.size.height)
                            .scaleEffect(recording ? 1.25 : 1)
                            .frame(width: 32, height: Theme.Metric.glassLarge)
                            .contentShape(Rectangle())
                            .pulseCompat(isActive: dictation.isListening || recording)
                            .gesture(micPress, including: micDisabled ? .subviews : .all)
                            .opacity(micDisabled ? 0.45 : 1)
                            .padding(.trailing, 6.3)
                            .accessibilityElement()
                            .accessibilityAddTraits(.isButton)
                            .accessibilityLabel(dictation.isListening ? "Stop dictation" : dictation.appleReason != nil ? "Start dictation (Apple on this iPhone, no xAI key)" : "Start dictation")
                            .accessibilityHint(Text("Touch and hold to record a voice note."))
                            .accessibilityAction { if !micDisabled { tapMic() } }
                            .accessibilityAction(named: Text("Record a voice note")) {
                                if !micDisabled { startVoiceNote(mode: .toggle) }
                            }
                            .accessibilityIdentifier("composer-mic")
                    }

                    if !voiceNote.isActive {
                        ComposerVoiceSendButton(
                            canSend: canSend,
                            busy: preparingAttachments || sendingMessage,
                            onCall: call.isOnCall(current),
                            blocked: activeSendBlock != nil,
                            send: { submit() },
                            voice: startVoiceMode
                        )
                        .padding(.trailing, 9.3)
                        .padding(.bottom, (Theme.Metric.glassLarge - Theme.Chat.voiceCapsule.height) / 2)
                    }
                }
            }
            .frame(minHeight: Theme.Metric.glassLarge)
            // 22 pt corners: a capsule at one line that keeps its
            // corners as the draft grows, the way Messages does.
            .themeGlass(RoundedRectangle(cornerRadius: 22, style: .continuous), interactive: false)
            .chatGlassRim(RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        // One margin on both sides, inside the safe area (the container
        // already keeps a landscape bar clear of the sensor housing, so
        // nothing is added for it here). The scrolling strips above bleed
        // back out to the edges (`composerStripBleed`).
        .padding(.horizontal, Theme.Chat.composerMargin)
        .padding(.top, Self.composerTopPadding)
        .padding(.bottom, composerFocused ? 8 : Theme.Chat.composerBottom)
        .frame(maxWidth: CompanionLayout.composerMaxWidth)
        .frame(maxWidth: .infinity)
        // the "/" menu reads the engine's commands once it opens
        .task(id: commandLoadKey) { await loadCommands() }
        // Steer needs to know whether the running engine takes words live
        .task(id: heldSends.isEmpty) {
            if !heldSends.isEmpty { await power.load(botIds: [], threadId: nil, groupId: nil, session: session) }
        }
    }

    /// The + at the capsule's leading end: a plain glyph, a filled disc
    /// with an x while the menu is open.
    var composerPlusButton: some View {
        Button {
            dictation.stop()
            composerFocused = false
            withAnimation(.snappy(duration: 0.28)) { showingPlus.toggle() }
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(showingPlus ? Theme.primaryInk : Theme.textPrimary)
                .rotationEffect(.degrees(showingPlus ? 45 : 0))
                .frame(width: 32, height: 32)
                .background(Circle().fill(showingPlus ? Theme.primaryFill : Color.clear))
                .frame(width: 36, height: Theme.Metric.glassLarge)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(preparingAttachments || sendingMessage)
        .accessibilityLabel(showingPlus ? "Close" : "More")
        .accessibilityIdentifier("composer-plus")
    }

    // MARK: - Voice note

    var micDisabled: Bool {
        (preparingAttachments || sendingMessage) && !voiceNote.isActive
    }

    func tapMic() {
        composerFocused = false
        // xAI's ears whenever a key serves (the session asks the server,
        // a minute's cache), else Apple on this iPhone with the reason shown
        let chat = current
        dictation.toggle(capturing: draft) { await session.dictationEars(for: chat) }
    }

    func startVoiceNote(mode: VoiceNoteRecorder.Mode) {
        guard !voiceNote.isActive, !preparingAttachments, !sendingMessage else { return }
        guard attachments.count < AttachmentPolicy.maximumItems else {
            attachmentError = String(localized: "Send up to \(AttachmentPolicy.maximumItems) items at a time.")
            return
        }
        dictation.stop()
        composerFocused = false
        showingPlus = false
        voiceNote.start(mode: mode)
    }

    /// The mic's press, read by VoiceNoteHold: a short tap is dictation, a
    /// hold records, the release sends and a slide left cancels.
    var micPress: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                if micPressStart == nil {
                    micPressStart = Date()
                    guard !voiceNote.isActive, !dictation.isListening, !dictation.isStarting else { return }
                    micHoldTask = Task { @MainActor in
                        try? await Task.sleep(nanoseconds: UInt64(VoiceNoteHold.holdThreshold * 1_000_000_000))
                        guard !Task.isCancelled, micPressStart != nil else { return }
                        startVoiceNote(mode: .hold)
                    }
                }
                if voiceNote.mode == .hold, voiceNote.phase == .recording {
                    let armed = VoiceNoteHold.cancels(translationX: value.translation.width)
                    if armed != voiceNote.cancelArmed {
                        voiceNote.cancelArmed = armed
                        Haptics.selection()
                    }
                }
            }
            .onEnded { value in
                let held = micPressStart.map { Date().timeIntervalSince($0) } ?? 0
                micPressStart = nil
                micHoldTask?.cancel()
                micHoldTask = nil
                let holding = voiceNote.mode == .hold && (voiceNote.phase == .recording || voiceNote.phase == .starting)
                switch VoiceNoteHold.outcome(heldFor: held, translationX: value.translation.width, recording: holding) {
                case .tap:
                    if !voiceNote.isActive { tapMic() }
                case .cancel:
                    voiceNote.cancel()
                case .send:
                    if holding { sendVoiceNote() }
                }
            }
    }

    /// Stop the recording and send it: the WAV as an attached file through
    /// the ordinary upload, its words (when this bot has speech to text) as
    /// the message's text, then the ordinary send, as on the desktop (#601).
    func sendVoiceNote() {
        guard voiceNote.phase == .recording else {
            voiceNote.cancel()
            return
        }
        guard let clip = voiceNote.finish() else { return }
        let chatAtSend = current
        let note = PendingMessageAttachment(
            id: UUID(), data: clip.wav, name: clip.name, mime: VoiceNoteRecording.mime, kind: .file
        )
        do {
            try AttachmentPolicy.validate(attachments + [note], sharedHost: session.surfaceGate.organization)
        } catch {
            attachmentError = error.localizedDescription
            return
        }
        voiceNote.markSending(true)
        preparingAttachments = true
        Task {
            var heard: String?
            if case let .bot(bot) = chatAtSend {
                heard = await session.transcribeVoiceNote(
                    pcm: clip.pcm, sampleRate: clip.sampleRate, botId: bot.id, threadId: chatAtSend.threadId
                )
            }
            preparingAttachments = false
            voiceNote.markSending(false)
            // The person moved to another conversation meanwhile: the note
            // waits in that conversation's draft instead of going anywhere.
            guard threadId == chatAtSend.threadId else {
                threadDrafts[chatAtSend.threadId, default: ComposerSnapshot()].attachments.append(note)
                return
            }
            attachments.append(note)
            if let heard, !heard.isEmpty { draft = Dictation.draft(base: draft, transcript: heard) }
            let notesToSend = attachments
            session.keepAttachmentDraft(notesToSend, threadId: chatAtSend.threadId)
            guard await session.finishAttachmentUploads(notesToSend), threadId == chatAtSend.threadId,
                  attachments.map(\.id) == notesToSend.map(\.id) else { return }
            submit()
        }
    }

    var composerPrompt: String {
        if sendingMessage { return String(localized: "Sending…") }
        if dictation.isListening { return String(localized: "Listening…") }
        if dictation.isProcessing { return String(localized: "Transcribing with xAI…") }
        return String(localized: "Message \(current.name)")
    }
}
