// Release notes on the large layout (#184; matrix DC21, P2-3): the desktop's
// `ReleaseNotesPrompt.tsx` as a modal over the shell, 520 pt wide at most.
//
// - What's new: once per version after an update, never on a fresh install
//   (`ReleaseNotes.whatsNew`, the desktop's `whatsNewDecision`), with the
//   running version's notes.
// - Release notes (the account menu, above About): the same dialog with a
//   version picker, newest first, the running one marked "(current)", and
//   "Changes since my last version".
//
// Same notes as the phone's account menu page (docs/releases/*.md, bundled
// as "releases"), in the person's language. The desktop also shows the next
// version's notes before it installs; on iOS the App Store and TestFlight
// install updates, so the app shows them after.
import CompanionCore
import SwiftUI

/// The notes bundled in the app, and what the person has seen of them.
enum ReleaseNotesStore {
    /// `seenReleaseRecord` (`sagax.releaseNotes.seen.v1` on the desktop); the
    /// phone's first record held the plain version under the same key.
    static let seenKey = "companion.releaseNotes.seen"

    static var catalog: [String: String] {
        guard let folder = Bundle.main.url(forResource: "releases", withExtension: nil) else { return [:] }
        return ReleaseNotes.catalog(in: folder)
    }

    static var current: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    }

    static var record: ReleaseNotesSeen? {
        ReleaseNotesSeen.read(UserDefaults.standard.string(forKey: seenKey))
    }

    /// The version "Changes since my last version" starts after.
    static var lastVersion: String? { record?.lastVersion(before: current) }

    /// The notes of `current` were seen: the version seen before is kept for "since".
    static func markSeen() {
        let next = record?.seeing(current) ?? ReleaseNotesSeen(version: current)
        UserDefaults.standard.set(next.json, forKey: seenKey)
    }

    /// Whether the app had a pairing when it launched (the desktop's
    /// `releaseNotesPriorInstall`): a fresh install has none.
    private(set) static var launchedPaired = false
    private static var captured = false
    private static var decided = false

    /// Called once at launch, before any pairing of this launch.
    static func captureLaunch(paired: Bool) {
        guard !captured else { return }
        captured = true
        launchedPaired = paired
    }

    /// What's new decides once per launch. A parity or UI test launch stays
    /// quiet unless it asks with `-releaseNotesWhatsNew`, which may also set
    /// the version seen before (`-releaseNotesSeen 0.4.10`).
    static func whatsNewOnLaunch(arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool {
        guard !decided else { return false }
        decided = true
        let asked = arguments.contains("-releaseNotesWhatsNew")
        if asked, let i = arguments.firstIndex(of: "-releaseNotesSeen"), i + 1 < arguments.count {
            UserDefaults.standard.set(ReleaseNotesSeen(version: arguments[i + 1]).json, forKey: seenKey)
        }
        let test = arguments.contains("-parityEndpoint") || arguments.contains("-uiTesting")
        let seen = record
        let decision = ReleaseNotes.whatsNew(version: current, dev: test && !asked, seen: seen?.version,
                                             previouslyInstalled: launchedPaired || asked)
        if let version = decision.seen, version != seen?.version {
            UserDefaults.standard.set((seen?.seeing(version) ?? ReleaseNotesSeen(version: version)).json, forKey: seenKey)
        }
        return decision.show
    }
}

/// The dialog: What's new (`current`) or Release notes (`browse`). The
/// desktop's `ReleaseNotesPrompt.tsx`: `DialogFrame` at `xl` (700 pt) with
/// Settings' wide margins, a title at the top left, the round close button,
/// the pill row under the title (Changes since my last version, the version
/// menu at the right), then the version heading with its date and the notes.
struct DesktopReleaseNotesModal: View {
    enum Mode { case current, browse }

    @Environment(\.desktopTheme) private var theme
    @Environment(\.locale) private var locale
    let mode: Mode
    let close: () -> Void
    @State private var picked = ReleaseNotesStore.current
    @State private var since = false

    private var language: String { locale.language.languageCode?.identifier ?? "en" }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.black.opacity(0.5)
                    .contentShape(Rectangle())
                    .onTapGesture(perform: close)
                    .accessibilityHidden(true)
                AnyView(box)
                    .frame(width: min(700, geometry.size.width - 48))
                    .frame(maxHeight: geometry.size.height - 48)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .ignoresSafeArea()
        .background(DesktopEscapeKey(action: close))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-release-notes")
    }

    /// `<!-- date: 2026-10-16 -->` as the desktop's `formatReleaseDate` writes it.
    private func date(_ markdown: String?) -> String? {
        guard let markdown,
              let match = markdown.range(of: #"<!--\s*date:\s*(\d{4}-\d{2}-\d{2})\s*-->"#, options: .regularExpression),
              let day = markdown[match].range(of: #"\d{4}-\d{2}-\d{2}"#, options: .regularExpression)
        else { return nil }
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = TimeZone(identifier: "UTC")
        parser.dateFormat = "yyyy-MM-dd'T'HH:mm"
        guard let when = parser.date(from: "\(markdown[day])T12:00") else { return nil }
        let out = DateFormatter()
        out.locale = locale
        out.timeZone = TimeZone(identifier: "UTC")
        out.dateStyle = .long
        return out.string(from: when)
    }

    private var box: some View {
        let catalog = ReleaseNotesStore.catalog
        let current = ReleaseNotesStore.current
        var versions = ReleaseNotes.versions(catalog)
        // the running version is always offered, even without its file
        if mode == .browse, !versions.contains(current) { versions.insert(current, at: 0) }
        let previous = ReleaseNotesStore.lastVersion
        let sinceEntries = mode == .browse && previous != nil ? ReleaseNotes.since(previous ?? "", current: current, catalog: catalog) : []
        let shown = mode == .browse ? picked : current
        let notes = catalog[shown].map { ReleaseNotes.section($0, language: language) } ?? ""
        return VStack(alignment: .leading, spacing: 0) {
            Text(mode == .browse ? String(localized: "Release notes") : String(localized: "What's new"))
                .font(theme.font(17, .semibold))
                .tracking(-0.14)
                .foregroundStyle(theme.ink)
                .frame(height: 24, alignment: .leading)
                .padding(.horizontal, 32)
                .padding(.top, 24)
                .padding(.bottom, 4)
                .padding(.trailing, 16)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("release-notes-title")
            if mode == .browse {
                HStack(spacing: 8) {
                    if !sinceEntries.isEmpty, let previous {
                        Button { since.toggle() } label: {
                            Text("Changes since my last version (\(previous))")
                                .font(theme.font(12))
                                .foregroundStyle(theme.ink)
                                .padding(.horizontal, 12)
                                .frame(height: 32)
                                .background(since ? theme.selected : theme.raised, in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(since ? .isSelected : [])
                        .accessibilityIdentifier("release-notes-since")
                    }
                    Spacer(minLength: 0)
                    Menu {
                        ForEach(versions, id: \.self) { version in
                            Button(version == current ? String(localized: "\(version) (current)") : version) {
                                picked = version
                                since = false
                            }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text(verbatim: picked == current ? String(localized: "\(picked) (current)") : picked)
                            Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold))
                        }
                        .font(theme.font(13))
                        .foregroundStyle(theme.ink)
                        .padding(.horizontal, 8)
                        .frame(height: 32)
                        .contentShape(Rectangle())
                    }
                    .accessibilityLabel(Text("Version"))
                    .accessibilityValue(Text(verbatim: picked))
                    .accessibilityIdentifier("release-notes-version")
                }
                .padding(.horizontal, 32)
                .padding(.top, 12)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if mode == .browse, since {
                        ForEach(sinceEntries.filter { catalog[$0] != nil }, id: \.self) { version in
                            versionBlock(version, catalog[version], language: language)
                        }
                    } else {
                        versionBlock(shown, catalog[shown], language: language)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 32)
                .padding(.top, 12)
                .padding(.bottom, 24)
            }
        }
        .overlay(alignment: .topTrailing) {
            Button(action: close) {
                DesktopIconView(icon: .x, size: 18, strokeWidth: 2)
                    .foregroundStyle(theme.inkTertiary)
                    .frame(width: 32, height: 32)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .padding(10)
            .accessibilityLabel(Text("Close"))
            .accessibilityIdentifier("release-notes-close")
        }
        .background(theme.app)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
        .onAppear { ReleaseNotesStore.markSeen() }
    }

    /// `ReleaseVersionHeading` (15/22 semibold, the date 12/16 grey) and the notes.
    private func versionBlock(_ version: String, _ markdown: String?, language: String) -> some View {
        // the hidden `<!-- date: ... -->` line is stripped from the text shown
        let text = (markdown.map { ReleaseNotes.section($0, language: language) } ?? "")
            .replacingOccurrences(of: #"<!--[\s\S]*?-->"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Version \(version)").font(theme.font(15, .semibold)).foregroundStyle(theme.ink).frame(height: 22, alignment: .leading)
                if let when = date(markdown) {
                    Text(verbatim: when).font(theme.font(12)).foregroundStyle(theme.inkSecondary).frame(height: 16, alignment: .leading)
                }
            }
            .padding(.horizontal, 4)
            if text.isEmpty {
                Text("Release notes for \(version) are not in this copy of Sagax.")
                    .font(theme.font(13))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 4)
            } else {
                MarkdownText(source: text)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("release-notes-text.\(version)")
    }
}
