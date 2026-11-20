// Sagax on the car's screen (docs/ios-carplay.md): a CarPlay voice-based
// conversational app. The entitlements
// (`com.apple.developer.carplay-voice-based-conversation`, iOS 26.4, and
// `com.apple.developer.carplay-driving-task`) and the CarPlay scene in
// Info.plist are in `project.yml`.
//
// The root is a tab bar (three tabs, Apple allows four), the depth Apple
// allows is three:
//   1. Bots: every bot by name and face, never a message (a list);
//   2. Recent: the bots used last, with when (a list);
//   3. To answer: the asks waiting for the person, by bot and title, each
//      opening an information screen (Approve, Deny, Talk by voice), read
//      aloud when one arrives;
//   and, over any of them, the call: CarPlay's voice screen while the bot
//   listens, thinks or speaks, with mute and hang up (iOS 26.4 buttons).
// Choosing a bot calls it: the conversation is the voice, as the category
// requires. An approval during the call is asked aloud or waits for the
// phone (DrivingSafety); nothing on this screen asks to pick up the iPhone.
//
// Every template operation reads the car's own stack first and passes a
// completion block (CarScreen): CarPlay raises an NSGenericException, and the
// app quits, for an operation it refuses without one (a pop with only the
// root on screen, a present over a presented template), and the car's Back
// control closes the voice screen without asking the app.
import CarPlay
import Combine
import CompanionCore
import os
import UIKit

private let log = Logger(subsystem: "ca.pulsatrix.sagax", category: "carplay")

@MainActor
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var interface: CPInterfaceController?
    private var tabs: CPTabBarTemplate?
    private var botsList: CPListTemplate?
    private var recentList: CPListTemplate?
    private var answerList: CPListTemplate?
    private var announced: Set<String> = []
    private var announcedLoaded = false
    private var voice: CPVoiceControlTemplate?
    /// the call (its bot or channel id) the voice screen was shown for
    private var voiceFor: String?
    private var shownState: CarVoiceState?
    private var faces: [String: UIImage] = [:]
    /// bots whose face was already tried (drawn or not), never redrawn
    private var facesTried: Set<String> = []
    private var subscriptions = Set<AnyCancellable>()

    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didConnect interfaceController: CPInterfaceController) {
        CarRoute.carPlayConnected = true
        interface = interfaceController
        let session = SessionHub.session
        session.connect()

        let bots = Self.makeList(title: String(localized: "Bots"), symbol: "person.2.fill",
                                 empty: String(localized: "No bots yet"),
                                 subtitle: String(localized: "Your bots appear here once Sagax is connected."))
        let recent = Self.makeList(title: String(localized: "Recent"), symbol: "clock.fill",
                                   empty: String(localized: "Nothing recent"),
                                   subtitle: String(localized: "The bots you talk to appear here."))
        let answer = Self.makeList(title: String(localized: "To answer"), symbol: "checkmark.bubble.fill",
                                   empty: String(localized: "Nothing to answer"),
                                   subtitle: String(localized: "A bot that needs you appears here."))
        botsList = bots
        recentList = recent
        answerList = answer
        let tabs = CPTabBarTemplate(templates: [bots, recent, answer])
        self.tabs = tabs
        interfaceController.setRootTemplate(tabs, animated: false, completion: Self.done("set the root"))
        reload(session.state)

        // a notification tapped on the phone while in the car opens the tab
        NotificationCenter.default.publisher(for: .sagaxCarOpenToAnswer)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.showToAnswer() }
            .store(in: &subscriptions)

        // the list follows the fleet, calmly (no faster than every 2 s)
        session.statePublisher
            .debounce(for: .seconds(2), scheduler: DispatchQueue.main)
            .sink { [weak self] state in self?.reload(state) }
            .store(in: &subscriptions)

        // a call, wherever it started (the car, Siri, the phone): its voice
        // screen is shown while it runs, as the category requires
        let call = CallController.shared
        call.$target.combineLatest(call.$state)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] target, state in self?.follow(target: target, state: state) }
            .store(in: &subscriptions)
        call.$unavailable
            .receive(on: DispatchQueue.main)
            .sink { [weak self] unavailable in
                guard let unavailable else { return }
                self?.alert(unavailable.title)
            }
            .store(in: &subscriptions)
    }

    /// `didDisconnectInterfaceController`, not `didDisconnect`: CarPlay never
    /// called the shorter name, so a car left behind its subscriptions and a
    /// voice screen the next car's stack does not hold.
    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        CarRoute.carPlayConnected = false
        subscriptions.removeAll()
        interface = nil
        tabs = nil
        botsList = nil
        recentList = nil
        answerList = nil
        announced = []
        announcedLoaded = false
        CarSpeaker.shared.stop()
        forgetVoice()
        faces = [:]
        facesTried = []
    }

    // MARK: - The list

    private static func makeList(title: String, symbol: String, empty: String, subtitle: String) -> CPListTemplate {
        let list = CPListTemplate(title: title, sections: [])
        list.tabTitle = title
        list.tabImage = UIImage(systemName: symbol) ?? UIImage()
        list.emptyViewTitleVariants = [empty]
        list.emptyViewSubtitleVariants = [subtitle]
        return list
    }

    private func reload(_ state: CompanionState) {
        guard let botsList, let recentList, let answerList else { return }
        let contacts = CarDirectory.contacts(bots: state.bots)
        let limit = min(CPListTemplate.maximumItemCount, CarDirectory.carLimit)
        let all = CarDirectory.alphabeticalBots(contacts, limit: limit)
        let recent = CarDirectory.recentBots(contacts, limit: limit)
        botsList.updateSections([CPListSection(items: all.map { botItem($0, detail: nil) }, header: String(localized: "Call a bot"), sectionIndexTitle: nil)])
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        recentList.updateSections([CPListSection(items: recent.map {
            botItem($0, detail: formatter.localizedString(for: Date(timeIntervalSince1970: $0.latestActivity / 1000), relativeTo: Date()))
        }, header: String(localized: "Call a bot"), sectionIndexTitle: nil)])
        var seen: Set<String> = []
        loadFaces((all + recent).filter { seen.insert($0.id).inserted }, state: state)

        let asks = CarApprovals.items(in: state)
        answerList.updateSections([CPListSection(items: asks.map(askItem), header: String(localized: "Waiting for you"), sectionIndexTitle: nil)])
        answerList.showsTabBadge = !asks.isEmpty
        announce(asks)
    }

    private func botItem(_ contact: CarContact, detail: String?) -> CPListItem {
        let item = CPListItem(text: contact.name, detailText: detail, image: faces[contact.id] ?? UIImage(systemName: "waveform.circle.fill"))
        item.handler = { [weak self] _, done in
            self?.call(contact)
            done()
        }
        return item
    }

    // MARK: - To answer

    private func askItem(_ ask: CarApproval) -> CPListItem {
        let item = CPListItem(text: ask.botName, detailText: ask.title, image: UIImage(systemName: "questionmark.bubble.fill"))
        item.handler = { [weak self] _, done in
            self?.showAsk(ask)
            done()
        }
        return item
    }

    /// An ask the person has not heard yet, while no call is running: the
    /// tab is shown and it is said once. What already waited when the car
    /// connected is on the tab, not said.
    private func announce(_ asks: [CarApproval]) {
        guard announcedLoaded else {
            announcedLoaded = true
            announced = Set(asks.map(\.requestId))
            return
        }
        let fresh = asks.filter { !announced.contains($0.requestId) }
        announced.formUnion(asks.map(\.requestId))
        guard let first = fresh.first else { return }
        showToAnswer()
        guard CallController.shared.target == nil else { return }
        CarSpeaker.shared.say(String(localized: "\(first.botName) needs an answer: \(first.title). Open To answer."))
    }

    private func showToAnswer() {
        guard let tabs, let answerList else { return }
        if #available(iOS 17.0, *) { tabs.select(answerList) }
    }

    private func showAsk(_ ask: CarApproval) {
        guard let interface else { return }
        let spoken = DrivingSafety.spokenDetail(ask.detail, driving: true)
        let info = CPInformationTemplate(
            title: ask.botName, layout: .leading,
            items: [CPInformationItem(title: ask.title, detail: spoken.isEmpty ? nil : spoken)],
            actions: [
                CPTextButton(title: String(localized: "Approve"), textStyle: .confirm) { [weak self] _ in
                    self?.answer(ask, allow: true)
                },
                CPTextButton(title: String(localized: "Deny"), textStyle: .cancel) { [weak self] _ in
                    self?.answer(ask, allow: false)
                },
                CPTextButton(title: String(localized: "Talk by voice"), textStyle: .normal) { [weak self] _ in
                    self?.popToRoot()
                    Task { await CarCalls.call(contactId: ask.botId) }
                },
            ]
        )
        if !CarScreen.canPush(carStack()) { popToRoot() }
        interface.pushTemplate(info, animated: true, completion: Self.done("push an ask"))
        if CallController.shared.target == nil {
            CarSpeaker.shared.say(String(localized: "\(ask.botName) asks: \(ask.title). \(spoken)"))
        }
    }

    /// Approve or Deny, once (never "always"): the answer goes the way the
    /// phone's own button sends it, a security key class still waits for the phone.
    private func answer(_ ask: CarApproval, allow: Bool) {
        CarSpeaker.shared.stop()
        popToRoot()
        Task { @MainActor in
            let session = SessionHub.session
            guard let chat = session.state.chat(forThread: ask.threadId),
                  let message = session.state.visibleTranscript(forThread: ask.threadId).first(where: { $0.card?.requestId == ask.requestId }),
                  let card = message.card, let tool = card.tool
            else { return }
            let pending = PendingApproval(message: message, card: card, requestId: ask.requestId, tool: tool)
            await session.decide(allow ? .allowOnce : .deny, on: pending, in: chat)
            reload(session.state)
        }
    }

    /// Each bot's mascot, drawn once (the notification's face).
    private func loadFaces(_ bots: [CarContact], state: CompanionState) {
        let missing = bots.filter { !facesTried.contains($0.id) }.compactMap { state.bot($0.id) }
        guard !missing.isEmpty else { return }
        for bot in missing {
            facesTried.insert(bot.id)
            if let data = MascotAvatarRenderer.render(PushSenderLook(bot: bot)), let image = UIImage(data: data, scale: MascotAvatarRenderer.scale) {
                faces[bot.id] = image
            }
        }
        reload(state)
    }

    private func call(_ contact: CarContact) {
        let call = CallController.shared
        if call.target?.id == contact.id {
            // the bot on the call: its voice screen again, when the car's
            // Back closed it
            if !carStack().voiceShown { forgetVoice() }
            follow(target: call.target, state: call.state)
            return
        }
        Task { await CarCalls.call(contactId: contact.id) }
    }

    // MARK: - The car's stack

    /// What the car's stack holds now: CarPlay's own, read each time.
    private func carStack() -> CarScreen.Stack {
        guard let interface else { return CarScreen.Stack(depth: 1) }
        let templates = interface.templates
        let shown = voice.map { voice in templates.contains { $0 === voice } } ?? false
        return CarScreen.Stack(depth: templates.count, voiceShown: shown, presented: interface.presentedTemplate != nil)
    }

    /// Back to the list, when something is above it (CarPlay refuses a pop
    /// with only the root on screen).
    private func popToRoot() {
        guard let interface, CarScreen.canPopToRoot(carStack()) else { return }
        interface.popToRootTemplate(animated: true, completion: Self.done("pop to the root"))
    }

    private func forgetVoice() {
        voice = nil
        voiceFor = nil
        shownState = nil
    }

    /// The completion every template operation passes: a refusal is logged,
    /// never raised.
    private nonisolated static func done(_ operation: String) -> @Sendable (Bool, (any Error)?) -> Void {
        { success, error in
            guard !success else { return }
            log.error("CarPlay refused to \(operation, privacy: .public): \(error?.localizedDescription ?? "no reason", privacy: .public)")
        }
    }

    // MARK: - The call

    private func follow(target: Chat?, state: CallState) {
        guard let interface else { return }
        let carState = target == nil ? nil : CarVoiceState(state)
        let held = voice != nil && voiceFor == target?.id
        switch CarScreen.callStep(calling: carState != nil, held: held, stack: carStack()) {
        case .none:
            return
        case .forget:
            forgetVoice()
            return
        case .close:
            forgetVoice()
            interface.popToRootTemplate(animated: true, completion: Self.done("close the voice screen"))
            return
        case let .show(popToRootFirst):
            if popToRootFirst { popToRoot() }
            let template = CPVoiceControlTemplate(voiceControlStates: CarVoiceState.allCases.map(voiceState))
            voice = template
            shownState = nil
            interface.pushTemplate(template, animated: true, completion: Self.done("push the voice screen"))
        case .update:
            break
        }
        voiceFor = target?.id
        if let carState, shownState != carState {
            shownState = carState
            voice?.activateVoiceControlState(withIdentifier: carState.rawValue)
        }
    }

    private func voiceState(_ state: CarVoiceState) -> CPVoiceControlState {
        let (title, symbol): (String, String) = switch state {
        case .connecting: (String(localized: "Calling…"), "phone.arrow.up.right")
        case .listening: (String(localized: "Listening"), "waveform")
        case .thinking: (String(localized: "Thinking…"), "ellipsis")
        case .speaking: (String(localized: "Speaking"), "speaker.wave.2.fill")
        case .paused: (String(localized: "Microphone off"), "mic.slash.fill")
        }
        let image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 72, weight: .regular))
        let voiceState = CPVoiceControlState(identifier: state.rawValue, titleVariants: [title], image: image, repeats: state != .paused)
        if #available(iOS 26.4, *) {
            voiceState.actionButtons = [muteButton(paused: state == .paused), hangUpButton()]
        }
        return voiceState
    }

    private func muteButton(paused: Bool) -> CPButton {
        let symbol = paused ? "mic.fill" : "mic.slash.fill"
        return CPButton(image: UIImage(systemName: symbol) ?? UIImage()) { _ in
            let call = CallController.shared
            call.setMuted(!call.state.muted)
        }
    }

    private func hangUpButton() -> CPButton {
        CPButton(image: UIImage(systemName: "phone.down.fill") ?? UIImage()) { _ in
            CallController.shared.end()
        }
    }

    /// A call that could not start: its title only. The details are for
    /// the phone, later; nothing here asks to pick it up.
    private func alert(_ title: String) {
        guard let interface else { return }
        let alert = CPAlertTemplate(titleVariants: [title], actions: [
            CPAlertAction(title: String(localized: "OK"), style: .cancel) { [weak self] _ in
                self?.dismissAlert()
            },
        ])
        switch CarScreen.alertStep(carStack()) {
        case .present:
            interface.presentTemplate(alert, animated: true, completion: Self.done("present an alert"))
        case .replace:
            interface.dismissTemplate(animated: false) { [weak interface] _, _ in
                interface?.presentTemplate(alert, animated: true, completion: Self.done("present an alert"))
            }
        }
    }

    private func dismissAlert() {
        guard let interface, carStack().presented else { return }
        interface.dismissTemplate(animated: true, completion: Self.done("dismiss an alert"))
    }
}
