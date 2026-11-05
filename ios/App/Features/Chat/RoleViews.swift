// Visible roles (2026-11-05, #2016): the desktop's RoleChip.tsx and
// RoleNoticeRow.tsx in SwiftUI. A Perspicax tool step carries a small chip
// with the role's human name ("Moi" for the person's own access), in the
// accent when the role differs from the previous step and in the warning
// tint for a read refused and run once as "Moi". A tap opens "Pourquoi ce
// rôle" under the step. A lapsed role, a refused write or a read refused
// with no fallback is a banner row with the missing permission. The words
// come from the app's catalog (`roles.*` keys) through `StepWords`.
import CompanionCore
import SwiftUI

extension VisibleRoles {
    /// The app's own id check (HumanID), so a GUID never shows.
    static let appOpaque: Opaque = { HumanID.isOpaque($0) }
}

/// The chip itself: a dot and the role's name. Stateless: the row owns
/// whether "why" is open, so the sentence can take the row's width.
struct PerspicaxRoleChip: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.desktopChatText) private var desktop
    let role: ToolRole
    let words: StepWords
    @Binding var open: Bool

    var body: some View {
        let label = VisibleRoles.label(role.ref, words: words, opaque: VisibleRoles.appOpaque)
        let changed = VisibleRoles.changed(role)
        let warns = VisibleRoles.warns(role)
        let accent = desktop?.accent ?? Theme.accent
        let warning = desktop?.warning ?? Theme.warning
        let tint: Color = warns ? warning : changed ? accent : (desktop?.inkSecondary ?? Theme.textSecondary)
        let dot: Color = changed ? accent : warns ? warning : (desktop?.inkTertiary ?? Theme.textTertiary).opacity(0.6)
        Button {
            Haptics.selection()
            withAnimation(.easeOut(duration: 0.15)) { open.toggle() }
        } label: {
            HStack(spacing: 4) {
                Circle().fill(dot).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .font(.system(size: 11))
            .foregroundStyle(tint)
            .padding(.horizontal, 6)
            .frame(minHeight: 18)
            .background(
                Capsule().fill(warns || changed ? tint.opacity(warns ? 0.10 : 0.12) : (desktop?.inset ?? Theme.inset))
            )
            .overlay(
                Capsule().strokeBorder(warns || changed ? tint.opacity(0.42) : (desktop?.hairline ?? Theme.hairline).opacity(0.6), lineWidth: 1)
            )
            .frame(maxWidth: 200, alignment: .leading)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .fixedSize(horizontal: true, vertical: false)
        .accessibilityLabel(Text(verbatim: words.t("roles.chip.aria", ["role": label])))
        .accessibilityHint(Text(verbatim: VisibleRoles.detail(role, words: words, opaque: VisibleRoles.appOpaque) ?? ""))
        .accessibilityAddTraits(open ? [.isSelected] : [])
        .accessibilityIdentifier("role-chip.\(role.slug.isEmpty ? "me" : role.slug)")
    }
}

/// "Pourquoi ce rôle" and its one sentence, under the step.
struct RoleWhyNote: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.desktopChatText) private var desktop
    let role: ToolRole
    let words: StepWords

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: words.t("roles.why.title"))
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(desktop?.inkTertiary ?? Theme.textTertiary)
            Text(verbatim: VisibleRoles.why(role, words: words, opaque: VisibleRoles.appOpaque))
                .font(.system(size: 12))
                .foregroundStyle(desktop?.ink ?? Theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            if let detail = VisibleRoles.detail(role, words: words, opaque: VisibleRoles.appOpaque) {
                Text(verbatim: detail)
                    .font(.system(size: 11))
                    .foregroundStyle(desktop?.inkTertiary ?? Theme.textTertiary)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .frame(maxWidth: 480, alignment: .leading)
        .background((desktop?.raised ?? Theme.card), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder((desktop?.hairline ?? Theme.hairline).opacity(0.5), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("role-why")
    }
}

/// A step's line with its role chip beside it (never inside the step's own
/// button) and, once tapped, why this role under both.
struct RoleStepLine<Line: View>: View {
    let role: ToolRole?
    let words: StepWords
    @ViewBuilder var line: () -> Line
    @State private var open: Bool

    init(role: ToolRole?, words: StepWords, @ViewBuilder line: @escaping () -> Line) {
        self.role = role
        self.words = words
        self.line = line
        #if DEBUG
        // the screenshot harness (-roles-preview-why): a fallback's "why" open
        _open = State(initialValue: role?.reason == "fallback" && ProcessInfo.processInfo.arguments.contains("-roles-preview-why"))
        #else
        _open = State(initialValue: false)
        #endif
    }

    var body: some View {
        // 2026-11-05 (JC): no role in the chat, the role lives on Flow routines only
        line()
    }
}

/// The banner row of a role fact (RoleNoticeRow.tsx).
struct RoleNoticeRowView: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.desktopChatText) private var desktop
    let notice: RoleNotice
    let botName: String?
    var words: StepWords = .app

    var body: some View {
        let lapsed = notice.kind == .lapsed
        let tint = lapsed ? (desktop?.warning ?? Theme.warning) : (desktop?.danger ?? Theme.danger)
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: lapsed ? "clock" : "exclamationmark.shield")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(tint)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: VisibleRoles.noticeText(notice, botName: botName, words: words, opaque: VisibleRoles.appOpaque))
                    .font(.system(size: 13))
                    .foregroundStyle(desktop?.ink ?? Theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                if let missing = VisibleRoles.missingLine(notice, words: words) {
                    Text(verbatim: missing)
                        .font(.system(size: 12))
                        .foregroundStyle(desktop?.inkSecondary ?? Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: 560, alignment: .leading)
        .background(tint.opacity(lapsed ? 0.10 : 0.07), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(tint.opacity(lapsed ? 0.40 : 0.35), lineWidth: 1))
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("role-notice.\(notice.kind.rawValue)")
    }
}
