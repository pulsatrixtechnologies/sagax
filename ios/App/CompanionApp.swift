// App entry, and the one place that decides when the event stream lives.
//
// A phone is not a desktop: the stream is torn down the moment the app
// leaves the screen's short background grace period, because iOS is going to
// suspend it anyway and doing it deliberately means the cursor is written
// down at a known point. Coming back asks the harness what was missed rather
// than asking for everything.
import SwiftUI
import UIKit
import CompanionCore
import UserNotifications
import Intents

@main
struct CompanionApp: App {
    // the one Session, shared with Siri and the car (CarAssist/CarAssist.swift)
    @StateObject private var session = SessionHub.session
    @Environment(\.scenePhase) private var scenePhase
    /// ⌘, (the app menu's Settings) for the iPad's desktop shell.
    @UIApplicationDelegateAdaptor(SagaxAppDelegate.self) private var appDelegate
    private var liveActivities: LiveActivityBridge { .shared }
    @State private var widgetSync = WidgetSyncBridge.makeAppGroupBridge()
    @AppStorage(PrefKey.language) private var language = AppLanguage.system.rawValue

    init() {
        // What's new needs to know whether this launch follows an earlier
        // use of the app (a pairing saved), before any pairing of this launch.
        ReleaseNotesStore.captureLaunch(paired: !SagaxSharedConnectionStore.loadRegistry().connections.isEmpty)
    }

    var body: some Scene {
        WindowGroup {
            #if DEBUG
            if ProviderSetupPreview.requested {
                // The CI screenshot. Skip pairing and the event stream.
                ProviderSetupPreview()
            } else {
                liveRoot
            }
            #else
            liveRoot
            #endif
        }
        // `.defaultSize` is iOS 17 and `SceneBuilder` takes no conditionals,
        // so it is dropped while the app supports 16. It only suggested an
        // opening window size for iPad and Stage Manager; the system picks a
        // sensible one on its own.
    }

    /// The paired app. The debug preview is a separate branch of the
    /// window, so a screenshot launch never opens the event stream.
    private var liveRoot: some View {
        MascotGalleryGate { BrowserGalleryGate { RootView().overlay { LaunchMascotOverlay() } } }
                .environmentObject(session)
                // One modifier is the whole language seam. SwiftUI resolves a
                // `LocalizedStringKey` against the environment's locale, so
                // every `Text("…")`, `Button("…")`, `Section("…")` and
                // `navigationTitle("…")` already in the app — including the
                // ones inside sheets and pushed screens — follows this line
                // without a call site changing. Following the system means
                // leaving it on the phone's own locale, which is what an app
                // with no language setting would use anyway.
                .environment(\.locale, AppLanguage.resolved(language).locale ?? .autoupdatingCurrent)
                // A navigation title is drawn by UIKit, which reads its string
                // once and does not re-read it when the environment changes —
                // so the body would switch language while the title above it
                // stayed behind. Re-identifying the tree on the chosen language
                // rebuilds that chrome. It costs the navigation stack and any
                // view state below, which is the right trade for something a
                // person changes deliberately and almost never. `session` lives
                // on the App, not here, so the connection survives.
                .id(language)
                // the language picked here is the person's (`omb-language`):
                // the server words pushes and rule texts in it, the desktop follows
                .onValueChange(of: language) { SidebarPrefsModel.shared.setLanguage(session, $0) }
                // Settings > App > Appearance: the skin, everywhere (ThemeStore.swift).
                .themeRoot()
                // Settings > Achievements: reads, reports and unlock banners (ST9).
                .achievementsHost(session)
                // a bot asks this phone for a tool: the card (Features/PhoneTools)
                .phoneToolsHost(session)
                .onAppear {
                    SagaxSharedInbox.removeDirectories(olderThan: 60 * 60)
                    session.connect()
                    session.resumeNativeAttachmentTransfers()
                    SagaxSharedTransfers.resume { session.actionError = $0 }
                    liveActivities.attach(to: session)
                    widgetSync.attach(to: session)
                }
                .onOpenURL { session.receiveURL($0) }
                // "Call Scout with Sagax", or calling again from the car or
                // the call screen (SiriIntentHandlers.swift): the CallKit call
                .onContinueUserActivity(NSStringFromClass(INStartCallIntent.self)) { activity in
                    guard let id = CarCalls.contactId(in: activity) else { return }
                    Task { await CarCalls.call(contactId: id) }
                }
                .onValueChange(of: scenePhase) { phase in
                    switch phase {
                    case .active:
                        SagaxSharedInbox.removeDirectories(olderThan: 60 * 60)
                        let kept = session.hasLiveStream
                        session.connect()
                        session.resumeNativeAttachmentTransfers()
                        SagaxSharedTransfers.resume { session.actionError = $0 }
                        // A stream kept through the background may have
                        // missed what changed meanwhile (an ask answered on
                        // the Mac, a conversation read there): the server's
                        // state is read again, so Updates, the badge and the
                        // banners follow it. A reconnect hydrates by itself.
                        if kept { Task { await session.resyncOnForeground() } }
                        liveActivities.sceneChanged(active: true)
                        Task { await session.refreshNotificationAuthorization() }
                        // A photo changed in Perspicax shows on the way back.
                        Task { await session.loadAccount() }
                    case .background:
                        liveActivities.sceneChanged(active: false)
                        session.linger()
                        if !session.isDemo { widgetSync.flush(session.state, connectionID: session.connection?.id) }
                    case .inactive: break
                    @unknown default: break
                    }
                }
    }
}

struct RootView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @AppStorage("companion.onboarding.welcomeSeen") private var hasSeenWelcome = false
    @AppStorage("companion.onboarding.notificationsSeen") private var hasSeenNotificationPrompt = false
    @AppStorage(CompanionOnboardingPreferences.pendingNotificationOnboardingKey)
    private var notificationOnboardingPending = false
    var body: some View {
        Group {
            switch route {
            case .welcome, .unpairedHome:
                welcome
            case .pairing:
                Group {
                    switch session.connectMode {
                    case .organization:
                        OrgSignInView(onBack: backToWelcome, onDone: {
                            hasSeenWelcome = true
                            session.endPairing()
                        })
                    case .computer:
                        PairingView(onCancel: {
                            hasSeenWelcome = true
                            session.endPairing()
                        }, onBack: session.connection == nil ? backToWelcome : nil)
                    }
                }
                .onAppear {
                    hasSeenWelcome = true
                    session.beginPairing()
                }
            case .notificationPrompt:
                NotificationOnboardingView {
                    hasSeenNotificationPrompt = true
                    notificationOnboardingPending = false
                    session.endPairing()
                }
                .onAppear { hasSeenWelcome = true }
            case .chats:
                // the phone's roster, or on an iPad the desktop shell
                // (Desktop/DesktopShell.swift); each applies the parity launcher
                HomeRoot()
                    // the terms of use, once per account (App Store 1.2);
                    // never over the screenshot harness
                    .sheet(isPresented: Binding(
                        get: { session.termsPending && !parityHarnessActive },
                        set: { if !$0 { session.termsPending = false } }
                    )) {
                        TermsAcceptanceSheet().environmentObject(session)
                    }
                    .onAppear {
                        hasSeenWelcome = true
                        // This is either an existing pairing or a new pairing
                        // which needed no notification education. Do not let
                        // a later voluntary unpair reopen Pairing by itself.
                        session.endPairing()
                        reconcileNotificationOnboarding()
                    }
            case .revoked:
                UnpairedView(
                    server: session.connection?.pairedWithServer == true,
                    endCode: session.sessionEndCode,
                    onPairAgain: {
                        // Keep the record: the new sign-in replaces its
                        // token. No sign-out, no push unregistration here.
                        hasSeenWelcome = true
                        session.signInAgain()
                    },
                    onChooseAnother: session.connections.first(where: {
                        $0.id != session.connection?.id
                    }).map { computer in
                        { session.switchComputer(to: computer.id) }
                    }
                )
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .onValueChange(of: session.pairingInvite) { invite in
            guard invite != nil else { return }
            hasSeenWelcome = true
            if session.isDemo { session.exitDemo() }
            session.beginPairing(.computer)
        }
        .onAppear {
            reconcileNotificationOnboarding()
            if DemoLaunch.opensAtLaunch, session.connection == nil { session.enterDemo() }
        }
        // The Primary Bot's look, kept for an offline launch (never the demo's).
        .onValueChange(of: session.brandMascot) { mascot in
            guard !session.isDemo else { return }
            BrandMascotCache.save(mascot, connectionID: session.connection?.id)
        }
        .onValueChange(of: session.notificationAuthorizationResolved) { _ in
            reconcileNotificationOnboarding()
        }
        .onValueChange(of: session.notificationAuthorization) { _ in
            reconcileNotificationOnboarding()
        }
        .onValueChange(of: notificationOnboardingPending) { isPending in
            if isPending { reconcileNotificationOnboarding() }
        }
        .alert(
            "Something went wrong",
            isPresented: Binding(
                get: { session.actionError != nil },
                set: { if !$0 { session.actionError = nil } }
            ),
            presenting: session.actionError
        ) { _ in
            Button("OK", role: .cancel) { session.actionError = nil }
        } message: { message in
            Text(message)
        }
    }

    private var route: CompanionOnboardingRoute {
        let pairingState: CompanionPairingState
        if session.status == .unauthorized {
            pairingState = .revoked
        } else if session.connection != nil {
            pairingState = .paired
        } else {
            pairingState = .unpaired
        }
        return CompanionOnboardingRouter.route(for: .init(
            pairingState: pairingState,
            hasSeenWelcome: hasSeenWelcome,
            pairingRequested: session.pairingRequested,
            hasPendingPairingInvite: session.pairingInvite != nil,
            notificationOnboardingPending: notificationOnboardingPending,
            hasSeenNotificationPrompt: hasSeenNotificationPrompt,
            notificationAuthorization: notificationAuthorizationState
        ))
    }

    private var notificationAuthorizationState: CompanionNotificationAuthorizationState {
        #if DEBUG
        // Store-preview runs are deterministic screenshot fixtures, not a
        // first pairing, and must keep landing on the requested chat surface.
        if ProcessInfo.processInfo.arguments.contains("-store-preview") { return .determined }
        if ParityLaunch.current != nil { return .determined }
        #endif
        guard session.notificationAuthorizationResolved else { return .unresolved }
        return session.notificationAuthorization == .notDetermined ? .notDetermined : .determined
    }

    private func reconcileNotificationOnboarding() {
        notificationOnboardingPending = CompanionNotificationOnboardingPolicy.shouldKeepPending(
            isPending: notificationOnboardingPending,
            hasCompletedStep: hasSeenNotificationPrompt,
            authorization: notificationAuthorizationState
        )
    }

    private func startPairing() {
        hasSeenWelcome = true
        session.beginPairing(.computer)
    }

    private var welcome: some View {
        SagaxWelcomeView(
            onOrganization: {
                hasSeenWelcome = true
                session.beginPairing(.organization)
            },
            onComputer: startPairing,
            onDemo: {
                hasSeenWelcome = true
                session.enterDemo()
            }
        )
    }

    /// Back from a connect page to the three choices.
    private func backToWelcome() {
        hasSeenWelcome = true
        session.endPairing()
    }
}

/// The token stopped working. Almost always because someone revoked this
/// phone on the computer — which is exactly what that button is for, so the
/// honest thing is to say so and offer to pair again.
struct UnpairedView: View {
    @Environment(\.themePalette) var themePalette
    var server = false
    var endCode: String?
    let onPairAgain: () -> Void
    let onChooseAnother: (() -> Void)?

    var body: some View {
        NavigationStack {
            EmptyStateView(
                title: server ? String(localized: "Your session has ended") : String(localized: "This device was unpaired"),
                systemImage: "lock.slash",
                description: description
            ) {
                Button(server ? "Sign in again" : "Pair again", action: onPairAgain)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                if let onChooseAnother {
                    Button("Use another computer", action: onChooseAnother)
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                }
            }
        }
    }

    /// What the server said, in words a person can act on.
    private var description: Text {
        guard server else {
            return Text("The connection was removed on your computer. Pair again to keep using your chats here.")
        }
        switch endCode {
        case "principal_disabled":
            return Text("Your account is disabled in Pulsatrix or on this Sagax server. Ask an administrator.")
        case "idp_session_ended":
            return Text("Your Pulsatrix sign-in has ended. Sign in again to keep using your chats here.")
        case "session_revoked":
            return Text("This session was signed out from another device or by an administrator. Sign in again to keep using your chats here.")
        case "session_expired":
            return Text("This session expired after a long time without use. Sign in again to keep using your chats here.")
        case SessionEndReason.serverChanged:
            return Text("This address now answers as another Sagax server. Sign in again to use it.")
        default:
            return Text("This server no longer recognizes this session. Sign in again to keep using your chats here.")
        }
    }
}

/// The app menu's Settings (⌘,), as on the desktop. iPadOS keeps ⌘, for its
/// own Settings item, so the item is replaced here and opens the desktop
/// shell's Settings modal (I5); the phone has no menu bar.
final class SagaxAppDelegate: UIResponder, UIApplicationDelegate {
    // APNs (PushRegistrar.swift, docs/ios-push.md): a token every launch,
    // handed to the server the app is signed in to.
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        _ = NotificationCoordinator.shared
        // The Live Activity buttons and the push refresh need the session
        // and the coordinator even when iOS launched the app in the
        // background for them, where no window appears.
        LiveActivityBridge.shared.attach(to: SessionHub.session)
        Task { @MainActor in PushRegistrar.shared.start() }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in PushRegistrar.shared.didRegister(tokenData: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in PushRegistrar.shared.didFail(error) }
    }

    /// A push woke the app in the background (`content-available`): count
    /// the unread again for the icon badge.
    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        guard let push = PushPayload(userInfo: userInfo) else { return completionHandler(.noData) }
        Task { @MainActor in
            // read on another device: its banner goes before the recount
            if push.kind == .read, let threadId = push.threadId {
                await NotificationCoordinator.shared.withdraw(threadId: threadId)
            }
            // an ask answered elsewhere: its banner goes (the extension did it
            // too; this covers a push that woke the app first)
            if push.kind == .settled, let requestId = push.requestId {
                await NotificationCoordinator.shared.withdraw(threadId: push.threadId, requestId: requestId)
                // and its buttons leave the island and the lock screen, even
                // when the state below cannot be read
                await LiveActivityBridge.settle(requestId: requestId)
            }
            let refreshed = await PushRegistrar.shared.backgroundRefresh?() ?? false
            completionHandler(refreshed ? .newData : .noData)
        }
    }

    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        guard builder.system == .main else { return }
        builder.remove(menu: .preferences)
        let settings = UIKeyCommand(
            title: AppStrings.localized("Settings…"), action: #selector(openDesktopSettings),
            input: ",", modifierFlags: .command
        )
        settings.wantsPriorityOverSystemBehavior = true
        builder.insertSibling(UIMenu(options: .displayInline, children: [settings]), afterMenu: .about)
    }

    /// Siri's requests, handled in the app's own process (iOS 14+):
    /// a message to a bot, a call to a bot (docs/ios-carplay.md).
    func application(_ application: UIApplication, handlerFor intent: INIntent) -> Any? {
        switch intent {
        case is INSendMessageIntent: SendMessageToBotHandler()
        case is INStartCallIntent: StartCallToBotHandler()
        default: nil
        }
    }

    @objc func openDesktopSettings() {
        NotificationCenter.default.post(name: .desktopOpenSettings, object: nil)
    }
}

/// The visual-parity harness (ParityLaunch, DEBUG only) is never in a
/// Release build, so the terms sheet always shows there.
private var parityHarnessActive: Bool {
    #if DEBUG
    // `-demo-skip-terms`: the demo's screenshots open on the home, not on
    // the terms sheet (DEBUG only; Release always shows it)
    if DemoLaunch.opensAtLaunch, ProcessInfo.processInfo.arguments.contains("-demo-skip-terms") { return true }
    return ParityLaunch.current != nil
    #else
    return false
    #endif
}
