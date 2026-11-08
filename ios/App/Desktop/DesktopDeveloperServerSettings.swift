import SwiftUI
import CompanionCore

// The server rows of Settings > Developer on iPad (#2729), drawn as
// DeveloperSettings.tsx draws them: DescribedRow + UnitField / Switch inside
// a SettingsGroup. Shown only to someone who may edit the server config
// (canEditConfig); a member who may not never sees them, never greyed.

/// One number field that saves itself: the range check, the error in place of
/// the grey line, the save in flight.
private struct DesktopNumberRow: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var model: DesktopSettingsModel
    let label: Text
    let description: Text?
    let unit: Text?
    let value: Int
    let range: ClosedRange<Int>
    let rangeError: String
    let rowId: String
    let identifier: String
    var width: CGFloat = 56
    let change: (Int) -> DesktopConfigChange
    @State private var error: String?

    var body: some View {
        DesktopDescribedRow(label, description: error.map { Text(verbatim: $0).foregroundColor(theme.danger) } ?? description, identifier: rowId) {
            DesktopUnitField(value: String(value), unit: unit, label: label, width: width, identifier: identifier,
                             disabled: model.saving.contains(rowId), invalid: error != nil,
                             edit: { error = nil }) { text in
                guard let number = Int(text), range.contains(number) else {
                    error = AppStrings.localized(rangeError)
                    return
                }
                guard number != value else { return }
                Task { error = await model.apply(change(number), key: rowId) }
            }
        }
    }
}

/// Bots: group turns and MCP calls (RoomTurnTimeoutSettings, McpCallTimeoutSettings).
struct DesktopDeveloperBotsGroup: View {
    @EnvironmentObject private var model: DesktopSettingsModel

    var body: some View {
        let config = model.config
        DesktopSettingsGroup(Text("Bots"), identifier: "developerBots") {
            DesktopNumberRow(
                label: Text("Group turns"),
                description: Text("Longest a bot may answer in a group. A conversation can set its own."),
                unit: Text("minutes"), value: config?.rooms?.turnTimeoutMinutes ?? 5, range: 1...1_440,
                rangeError: "Enter a whole number from 1 to 1,440.", rowId: "roomTurns",
                identifier: "desktop-settings.room-turns", change: { .roomTurnMinutes($0) })
            DesktopNumberRow(
                label: Text("MCP calls"),
                description: Text("Longest a bot's MCP tool call may run."),
                unit: Text("minutes"),
                value: config?.mcp?.callTimeoutMinutes ?? DesktopConfigChange.defaultMcpMinutes,
                range: DesktopConfigChange.mcpMinutes,
                rangeError: "Enter a whole number from 1 to 60.", rowId: "mcpCalls",
                identifier: "desktop-settings.mcp-calls", change: { .mcpCallTimeout($0) })
        }
    }
}

/// Loop guard (AdvancedSettings.tsx LoopGuardRow): on unless turned off.
struct DesktopLoopGuardGroup: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var model: DesktopSettingsModel
    @State private var error: String?

    var body: some View {
        let enabled = model.config?.loopGuard?.enabled != false
        DesktopSettingsGroup(Text("Loop guard"), identifier: "loopGuard") {
            DesktopDescribedRow(Text("Loop guard"),
                                description: error.map { Text(verbatim: $0).foregroundColor(theme.danger) }
                                    ?? Text("Steer, then stop, when a shell command keeps failing the same way."),
                                identifier: "loopGuard") {
                DesktopSwitch(isOn: enabled, label: Text("Turn the loop guard on or off for this installation"),
                              identifier: "desktop-settings.loop-guard", disabled: model.saving.contains("loopGuard")) {
                    Task { error = await model.apply(.loopGuard(!enabled), key: "loopGuard") }
                }
            }
        }
    }
}

/// Event log cleanup (ThreadCleanupSettings.tsx): two rows, each a field and
/// its switch. The switch turns the knob on with the value in the field; the
/// field is off while its switch is.
struct DesktopEventLogCleanupGroup: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var model: DesktopSettingsModel
    @State private var retentionDraft: String?
    @State private var capDraft: String?
    @State private var error: String?
    @State private var errorKnob: String?

    var body: some View {
        let days = model.config?.threads?.eventLogRetentionDays
        let cap = model.config?.threads?.eventLogMaxBytes
        let pending = model.saving.contains("cleanup")
        let retentionValue = retentionDraft ?? String(days ?? DesktopConfigChange.defaultRetentionDays)
        let capValue = capDraft ?? (cap.map(DesktopConfigChange.mibText) ?? DesktopConfigChange.mibText(Int(DesktopConfigChange.defaultCapMiB * 1_048_576)))
        DesktopSettingsGroup(Text("Event log cleanup"), identifier: "threadCleanup") {
            DesktopDescribedRow(Text("Delete event logs after"),
                                description: errorKnob == "retention" ? Text(verbatim: error ?? "").foregroundColor(theme.danger)
                                    : Text("Finished conversations only, never the conversations themselves."),
                                identifier: "retention") {
                DesktopUnitField(value: retentionValue, unit: Text("days"), label: Text("Delete event logs after"),
                                 identifier: "desktop-settings.cleanup-days", disabled: days == nil || pending,
                                 invalid: errorKnob == "retention", edit: { clearError() }) { text in
                    retentionDraft = text
                    guard let value = Self.days(text) else { return fail("Enter a number of days between 1 and 3650.", "retention") }
                    guard value != days else { return }
                    save(.eventLogRetention(value), "retention")
                }
                DesktopSwitch(isOn: days != nil, label: Text("Delete event logs after"),
                              identifier: "desktop-settings.cleanup", disabled: pending) {
                    if days != nil {
                        retentionDraft = nil
                        save(.eventLogRetention(nil), "retention")
                    } else if let value = Self.days(retentionValue) {
                        save(.eventLogRetention(value), "retention")
                    } else {
                        fail("Enter a number of days between 1 and 3650.", "retention")
                    }
                }
            }
            DesktopDescribedRow(Text("Trim each event log to"),
                                description: errorKnob == "cap" ? Optional(Text(verbatim: error ?? "").foregroundColor(theme.danger))
                                    : error.map { Text(verbatim: $0).foregroundColor(theme.danger) }
                                    ?? (pending ? Text("Saving…") : nil),
                                identifier: "cap") {
                DesktopUnitField(value: capValue, unit: Text("MiB"), label: Text("Trim each event log to"), decimal: true,
                                 identifier: "desktop-settings.cleanup-cap", disabled: cap == nil || pending,
                                 invalid: errorKnob == "cap", edit: { clearError() }) { text in
                    capDraft = text
                    guard let bytes = DesktopConfigChange.capBytes(fromMiB: text) else { return fail("Enter a size between 0.25 and 4096 MiB.", "cap") }
                    guard bytes != cap else { return }
                    save(.eventLogMaxBytes(bytes), "cap")
                }
                DesktopSwitch(isOn: cap != nil, label: Text("Trim each event log to"),
                              identifier: "desktop-settings.cleanup-cap-switch", disabled: pending) {
                    if cap != nil {
                        capDraft = nil
                        save(.eventLogMaxBytes(nil), "cap")
                    } else if let bytes = DesktopConfigChange.capBytes(fromMiB: capValue) {
                        save(.eventLogMaxBytes(bytes), "cap")
                    } else {
                        fail("Enter a size between 0.25 and 4096 MiB.", "cap")
                    }
                }
            }
        }
    }

    static func days(_ text: String) -> Int? {
        guard let value = Int(text.trimmingCharacters(in: .whitespaces)), DesktopConfigChange.retentionDays.contains(value) else { return nil }
        return value
    }

    private func clearError() {
        error = nil
        errorKnob = nil
    }

    private func fail(_ message: String, _ knob: String) {
        error = AppStrings.localized(message)
        errorKnob = knob
    }

    private func save(_ change: DesktopConfigChange, _ knob: String) {
        clearError()
        Task {
            if let failure = await model.apply(change, key: "cleanup") {
                error = failure
                errorKnob = knob
            } else if knob == "retention" {
                retentionDraft = nil
            } else {
                capDraft = nil
            }
        }
    }
}

/// "Review after this many tool steps" (SkillReviewSettings.tsx), under the
/// skill-writing switch while it is on.
struct DesktopSkillReviewRow: View {
    @EnvironmentObject private var model: DesktopSettingsModel

    var body: some View {
        DesktopNumberRow(
            label: Text("Review after this many tool steps"), description: nil, unit: nil,
            value: model.config?.features?.skillReviewSteps ?? DesktopConfigChange.defaultReviewSteps,
            range: DesktopConfigChange.reviewSteps,
            rangeError: String(format: AppStrings.localized("Enter a whole number from %@ to %@."), "3", "100"),
            rowId: "skillReviewSteps", identifier: "desktop-settings.skill-review-steps", width: 72,
            change: { .skillReviewSteps($0) })
    }
}

// MARK: - OpenTelemetry

/// OpenTelemetry (TelemetrySettings.tsx): the export state, the collector,
/// the service name, the headers (values go up once, never shown again), and
/// Save / Send a test span / Turn off.
struct DesktopTelemetryGroup: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var model: DesktopSettingsModel
    @State private var view: TelemetrySettingsView?
    @State private var endpoint = ""
    @State private var serviceName = ""
    @State private var headers: [TelemetryHeaderDraft] = []
    @State private var dirtyHeaders = false
    @State private var busy = false
    @State private var note: (text: String, error: Bool)?

    var body: some View {
        DesktopSettingsGroup(Text("OpenTelemetry"), identifier: "telemetry") {
            let summary = view?.summary ?? TelemetrySettingsView().summary
            DesktopDescribedRow(Text("Trace export"),
                                description: Text(verbatim: String(format: AppStrings.localized(summary.format), arguments: summary.arguments)),
                                help: Text("Sends the server's traces (bot turns, model calls with tokens and cost, tool and MCP calls, sub-agents, routines) to an OTLP/HTTP collector, following the OpenTelemetry GenAI conventions. Usage statistics keep working without a collector."),
                                identifier: "telemetry.export") {
                DesktopText(view?.enabled == true ? Text("On") : Text("Off"), size: 12,
                            color: view?.enabled == true ? \.success : \.inkSecondary)
            }
            fieldRow(Text("Collector address"), hint: Text("OTLP/HTTP base URL; /v1/traces is added."), rowId: "telemetry.endpoint") {
                field($endpoint, placeholder: "https://otel.example.org:4318", label: Text("Collector address"),
                      identifier: "desktop-settings.telemetry-endpoint", url: true)
            }
            fieldRow(Text("Service name"), hint: Text("service.name of the traces; sagax when empty."), rowId: "telemetry.serviceName") {
                field($serviceName, placeholder: "sagax", label: Text("Service name"),
                      identifier: "desktop-settings.telemetry-service")
            }
            VStack(alignment: .leading, spacing: 6) {
                DesktopText("Headers", color: \.ink)
                ForEach($headers) { $row in
                    HStack(spacing: 8) {
                        field($row.name, placeholder: "Authorization", label: Text("Header name"),
                              identifier: "desktop-settings.telemetry-header-name", locked: row.saved, onEdit: { dirtyHeaders = true })
                            .frame(maxWidth: 220)
                        secure($row.value, placeholder: row.saved ? AppStrings.localized("Saved (type to replace)") : AppStrings.localized("Value"),
                               label: Text("Header value"))
                        Button("Remove") {
                            headers.removeAll { $0.id == row.id }
                            dirtyHeaders = true
                        }
                        .buttonStyle(DesktopPillButtonStyle(danger: true))
                        .disabled(busy)
                    }
                }
                DesktopText("An API key or a token for the collector. Values are never shown again.", size: 12, line: 16, color: \.inkSecondary)
                Button("Add a header") {
                    headers.append(TelemetryHeaderDraft())
                    dirtyHeaders = true
                }
                .buttonStyle(DesktopPillButtonStyle())
                .disabled(busy || view == nil)
                .accessibilityIdentifier("desktop-settings.telemetry-add-header")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("settings-row.telemetry.headers")
            HStack(spacing: 8) {
                Button("Save") { save() }
                    .buttonStyle(DesktopPillButtonStyle(primary: true))
                    .disabled(busy || !canSave)
                    .accessibilityIdentifier("desktop-settings.telemetry-save")
                Button("Send a test span") { test() }
                    .buttonStyle(DesktopPillButtonStyle())
                    .disabled(busy || !canTest)
                    .accessibilityIdentifier("desktop-settings.telemetry-test")
                if view?.enabled == true {
                    Button("Turn off") { remove() }
                        .buttonStyle(DesktopPillButtonStyle(danger: true))
                        .disabled(busy)
                        .accessibilityIdentifier("desktop-settings.telemetry-off")
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            if let note {
                DesktopText(verbatim: note.text, size: 12, line: 16, color: note.error ? \.danger : \.inkSecondary)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 8)
            }
        }
        .task { await load() }
    }

    private var changed: Bool {
        endpoint.trimmingCharacters(in: .whitespaces) != (view?.endpoint ?? "")
            || serviceName.trimmingCharacters(in: .whitespaces) != (view?.serviceName ?? "")
            || dirtyHeaders
    }
    private var canSave: Bool { view != nil && !endpoint.trimmingCharacters(in: .whitespaces).isEmpty && changed }
    private var canTest: Bool { view != nil && (!endpoint.trimmingCharacters(in: .whitespaces).isEmpty || view?.enabled == true) }

    private func fieldRow<Control: View>(_ label: Text, hint: Text, rowId: String, @ViewBuilder control: () -> Control) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            DesktopText(label, color: \.ink)
            control()
            DesktopText(hint, size: 12, line: 16, color: \.inkSecondary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("settings-row.\(rowId)")
    }

    /// `FIELD`: the inset well, 8 pt corners, the hairline border.
    private func field(_ text: Binding<String>, placeholder: String, label: Text, identifier: String,
                       url: Bool = false, locked: Bool = false, onEdit: @escaping () -> Void = {}) -> some View {
        TextField(text: Binding(get: { text.wrappedValue }, set: { text.wrappedValue = $0; onEdit() }),
                  prompt: Text(verbatim: placeholder).foregroundColor(theme.inkTertiary)) { label }
            .font(theme.font(13))
            .foregroundStyle(theme.ink)
            .keyboardType(url ? .URL : .default)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .disabled(busy || view == nil || locked)
            .modifier(DesktopFieldWell())
            .accessibilityIdentifier(identifier)
    }

    private func secure(_ text: Binding<String>, placeholder: String, label: Text) -> some View {
        SecureField(text: Binding(get: { text.wrappedValue }, set: { text.wrappedValue = $0; dirtyHeaders = true }),
                    prompt: Text(verbatim: placeholder).foregroundColor(theme.inkTertiary)) { label }
            .font(theme.font(13))
            .foregroundStyle(theme.ink)
            .disabled(busy)
            .modifier(DesktopFieldWell())
            .accessibilityIdentifier("desktop-settings.telemetry-header-value")
    }

    private func apply(_ next: TelemetrySettingsView) {
        view = next
        endpoint = next.endpoint ?? ""
        serviceName = next.serviceName ?? ""
        headers = next.headerNames.map { TelemetryHeaderDraft(name: $0, saved: true) }
        dirtyHeaders = false
    }

    private func load() async {
        guard view == nil, let client = model.client else { return }
        do { apply(try await client.telemetrySettings()) } catch {
            note = (AppStrings.localized("Could not load the OpenTelemetry settings."), true)
        }
    }

    private func run(_ work: @escaping (CompanionClient) async throws -> String) {
        guard let client = model.client else { return }
        busy = true
        note = nil
        Task {
            do { note = (try await work(client), false) } catch {
                let message = error.localizedDescription
                note = (message.isEmpty ? AppStrings.localized("That did not work.") : message, true)
            }
            busy = false
        }
    }

    private func save() {
        let headerObject = TelemetryHeaderDraft.object(headers)
        let typed = endpoint, service = serviceName
        run { client in
            apply(try await client.saveTelemetry(endpoint: typed, headers: headerObject, serviceName: service))
            return AppStrings.localized("Saved. Traces go to the collector within a few seconds.")
        }
    }

    private func test() {
        let headerObject = TelemetryHeaderDraft.object(headers)
        let typed = endpoint
        run { client in
            guard try await client.testTelemetry(endpoint: typed, headers: headerObject) else {
                throw TelemetryTestRefused()
            }
            return AppStrings.localized("The collector accepted the test span.")
        }
    }

    private func remove() {
        run { client in
            apply(try await client.removeTelemetry())
            return AppStrings.localized("Export is off.")
        }
    }
}

private struct TelemetryTestRefused: LocalizedError {
    var errorDescription: String? { AppStrings.localized("That did not work.") }
}

/// `FIELD` of SettingsPrimitives.tsx: an inset well with the hairline border.
struct DesktopFieldWell: ViewModifier {
    @Environment(\.desktopTheme) private var theme

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 10)
            .frame(height: 32)
            .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.border, lineWidth: 0.5))
    }
}
