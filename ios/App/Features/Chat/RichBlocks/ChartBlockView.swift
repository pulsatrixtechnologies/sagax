// A ```chart fence (`ChartBlock.tsx`): a JSON spec or CSV rows drawn as a
// bar, line, area or donut chart from parsed numbers, never from model
// markup. Bars, lines and areas use Swift Charts; the donut is drawn by hand
// (SectorMark needs iOS 17). The eight categorical slots come in a fixed
// order with a light and a dark step; a legend shows for two or more
// series; a tap reads the values at a point; the header's tools switch to
// the same numbers as a table, or to the source.
import SwiftUI
import Charts
import CompanionCore

struct ChartBlockView: View {
    @Environment(\.themePalette) var themePalette
    let code: String
    var pending = false
    var identifier: String?
    let inline: (String, Bool) -> Text
    let plain: (String) -> String

    private enum Mode { case chart, table, source }
    @State private var mode: Mode = .chart
    @State private var active: Int?

    private var parsed: Result<ChartSpec, RichBlocks.ChartError>? {
        pending ? nil : RichBlocks.parseChartSpec(code)
    }

    var body: some View {
        let parsed = self.parsed
        let spec = try? parsed?.get()
        let title = spec?.title ?? String(localized: "Chart")
        RichBlockFrame(icon: "chart.bar.xaxis", title: title, identifier: identifier) {
            RichToolButton(icon: "tablecells", label: "Table view", pressed: mode == .table, identifier: identifier.map { "\($0)-table-toggle" }) {
                guard spec != nil else { return }
                mode = mode == .table ? .chart : .table
            }
            .disabled(spec == nil)
            RichToolButton(
                icon: "chevron.left.forwardslash.chevron.right",
                label: mode == .source ? "Hide source" : "View source",
                pressed: mode == .source,
                identifier: identifier.map { "\($0)-source-toggle" }
            ) {
                mode = mode == .source ? .chart : .source
            }
        } content: {
            if pending {
                Text("The chart is still being written.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 22)
            } else if let spec {
                switch mode {
                case .table:
                    RichTableView(
                        table: chartTable(spec), literal: true,
                        identifier: identifier.map { "\($0)-table" }, inline: inline, plain: plain
                    )
                    .padding(8)
                case .chart:
                    chart(spec)
                case .source:
                    EmptyView()
                }
            } else if case let .failure(error)? = parsed {
                Text("This chart could not be drawn: \(error.reason)")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.danger)
                    .padding(.horizontal, 10)
                    .padding(.top, 8)
                    .accessibilityIdentifier(identifier.map { "\($0)-invalid" } ?? "chart-invalid")
            }
            if mode == .source || (spec == nil && !pending) {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(verbatim: code)
                        .font(Theme.Font.code)
                        .foregroundStyle(Theme.textPrimary)
                        .textSelection(.enabled)
                        .padding(10)
                }
                .frame(maxHeight: 320)
            }
        }
    }

    private func chartTable(_ spec: ChartSpec) -> MarkdownTable {
        let table = RichBlocks.chartTable(spec)
        return MarkdownTable(
            headers: table.header,
            alignments: table.align.map { $0 == .right ? .trailing : .leading },
            rows: table.rows,
            declared: table.align.map { $0 != nil }
        )
    }

    @ViewBuilder
    private func chart(_ spec: ChartSpec) -> some View {
        let pie = spec.type == .pie
        let legend = pie ? spec.labels : spec.series.map(\.name)
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .top) {
                if pie {
                    DonutChart(spec: spec, active: $active)
                        .frame(height: 200)
                } else {
                    CartesianChart(spec: spec, active: $active)
                        .frame(height: 220)
                }
                if let active, active < spec.labels.count {
                    tooltip(spec, index: active)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("\(title(spec)), \(spec.labels.count) points"))
            .accessibilityIdentifier(identifier.map { "\($0)-plot" } ?? "chart-plot")
            if legend.count > 1 {
                FlowLegend(names: Array(legend.prefix(pie ? 24 : 8)))
            }
            if spec.truncatedSeries > 0 {
                Text("\(spec.truncatedSeries) more series not shown.")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .padding(10)
    }

    private func title(_ spec: ChartSpec) -> String {
        spec.title ?? String(localized: "Chart")
    }

    private func tooltip(_ spec: ChartSpec, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: spec.labels[index])
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(Theme.textPrimary)
            if spec.type == .pie {
                row(color: ChartPalette.color(index), name: nil, value: spec.series[0].values[index])
            } else {
                ForEach(Array(spec.series.enumerated()), id: \.offset) { seriesIndex, series in
                    row(color: ChartPalette.color(seriesIndex), name: series.name, value: index < series.values.count ? series.values[index] : nil)
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .frame(minWidth: 120, maxWidth: 240, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Theme.cardRaised))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.hairline.opacity(0.5), lineWidth: 0.5))
        .shadow(color: .black.opacity(0.2), radius: 6, y: 2)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(identifier.map { "\($0)-tooltip" } ?? "chart-tooltip")
        .onTapGesture { active = nil }
    }

    private func row(color: Color, name: String?, value: Double?) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 8, height: 8)
            if let name {
                Text(verbatim: name).lineLimit(1).foregroundStyle(Theme.textSecondary)
            }
            Spacer(minLength: 8)
            Text(verbatim: RichBlocks.formatChartValue(value)).monospacedDigit().foregroundStyle(Theme.textPrimary)
        }
        .font(.system(size: 11.5))
    }
}

/// Bars, lines and areas. Labels sit on a band axis in their order; a tap
/// picks the nearest label.
private struct CartesianChart: View {
    @Environment(\.themePalette) var themePalette
    let spec: ChartSpec
    @Binding var active: Int?

    private struct Point: Identifiable {
        let id: String
        let index: Int
        let label: String
        let series: String
        let seriesIndex: Int
        let value: Double
    }

    private var points: [Point] {
        spec.series.enumerated().flatMap { seriesIndex, series in
            series.values.enumerated().compactMap { index, value -> Point? in
                guard let value, index < spec.labels.count else { return nil }
                return Point(
                    id: "\(seriesIndex)-\(index)", index: index, label: axisLabel(index),
                    series: series.name.isEmpty ? " " : series.name, seriesIndex: seriesIndex, value: value
                )
            }
        }
    }

    /// Duplicate labels would share one band; a zero-width suffix keeps
    /// every point its own place while it reads the same.
    private func axisLabel(_ index: Int) -> String {
        let label = spec.labels[index]
        let earlier = spec.labels[..<index].filter { $0 == label }.count
        return earlier == 0 ? label : label + String(repeating: "\u{200B}", count: earlier)
    }

    private var domain: [String] { spec.series.map { $0.name.isEmpty ? " " : $0.name } }

    var body: some View {
        let names = domain
        let colors = names.indices.map(ChartPalette.color)
        Chart(points) { point in
            switch spec.type {
            case .bar:
                BarMark(x: .value("Label", point.label), y: .value("Value", point.value))
                    .foregroundStyle(by: .value("Series", point.series))
                    .position(by: .value("Series", point.series))
                    .opacity(active == nil || active == point.index ? 1 : 0.45)
                    .cornerRadius(3)
            case .area:
                AreaMark(x: .value("Label", point.label), y: .value("Value", point.value), stacking: .unstacked)
                    .foregroundStyle(by: .value("Series", point.series))
                    .opacity(0.16)
                LineMark(x: .value("Label", point.label), y: .value("Value", point.value))
                    .foregroundStyle(by: .value("Series", point.series))
                    .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            default:
                LineMark(x: .value("Label", point.label), y: .value("Value", point.value))
                    .foregroundStyle(by: .value("Series", point.series))
                    .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                if spec.labels.count <= 40 || active == point.index {
                    PointMark(x: .value("Label", point.label), y: .value("Value", point.value))
                        .foregroundStyle(by: .value("Series", point.series))
                        .symbolSize(active == point.index ? 60 : 24)
                }
            }
            if let active, active == point.index, point.seriesIndex == 0, spec.type != .bar {
                RuleMark(x: .value("Label", point.label))
                    .foregroundStyle(Theme.textSecondary.opacity(0.3))
            }
        }
        .chartForegroundStyleScale(domain: names, range: colors)
        .chartLegend(.hidden)
        .chartXAxis {
            AxisMarks { value in
                AxisValueLabel {
                    if let label = value.as(String.self) {
                        let shown = label.replacingOccurrences(of: "\u{200B}", with: "")
                        Text(verbatim: shown.count > 14 ? String(shown.prefix(13)) + "…" : shown)
                    }
                }
            }
        }
        .chartXAxisLabel(spec.xLabel ?? "")
        .chartYAxisLabel(spec.yLabel ?? "")
        .foregroundStyle(Theme.textSecondary)
        .chartOverlay { proxy in
            GeometryReader { geometry in
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .gesture(SpatialTapGesture().onEnded { tap in
                        let origin = geometry[proxy.plotAreaFrame].origin
                        guard let label: String = proxy.value(atX: tap.location.x - origin.x) else { return }
                        let index = spec.labels.indices.first { axisLabel($0) == label }
                        active = active == index ? nil : index
                    })
            }
        }
    }
}

/// The donut: one ring of slices with the total in the middle.
private struct DonutChart: View {
    @Environment(\.themePalette) var themePalette
    let spec: ChartSpec
    @Binding var active: Int?

    var body: some View {
        let values = spec.series[0].values.map { max(0, $0 ?? 0) }
        let total = values.reduce(0, +)
        GeometryReader { geometry in
            let size = min(geometry.size.width, geometry.size.height)
            let center = CGPoint(x: geometry.size.width / 2, y: geometry.size.height / 2)
            let outer = size / 2 - 4
            let inner = outer * 0.58
            ZStack {
                ForEach(Array(slices(values, total: total).enumerated()), id: \.offset) { index, slice in
                    if values[index] > 0 {
                        Path { path in
                            path.addArc(center: center, radius: outer, startAngle: slice.start, endAngle: slice.end, clockwise: false)
                            path.addArc(center: center, radius: inner, startAngle: slice.end, endAngle: slice.start, clockwise: true)
                            path.closeSubpath()
                        }
                        .fill(ChartPalette.color(index).opacity(active == nil || active == index ? 1 : 0.45))
                        .overlay(
                            Path { path in
                                path.addArc(center: center, radius: outer, startAngle: slice.start, endAngle: slice.end, clockwise: false)
                                path.addArc(center: center, radius: inner, startAngle: slice.end, endAngle: slice.start, clockwise: true)
                                path.closeSubpath()
                            }
                            .stroke(Theme.inset, lineWidth: 2)
                        )
                        .contentShape(Path { path in
                            path.addArc(center: center, radius: outer, startAngle: slice.start, endAngle: slice.end, clockwise: false)
                            path.addArc(center: center, radius: inner, startAngle: slice.end, endAngle: slice.start, clockwise: true)
                            path.closeSubpath()
                        })
                        .onTapGesture { active = active == index ? nil : index }
                    }
                }
                Text(verbatim: RichBlocks.formatTick(total == 0 ? 1 : total))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .position(center)
            }
        }
    }

    private func slices(_ values: [Double], total: Double) -> [(start: Angle, end: Angle)] {
        var angle = -90.0
        let sum = total == 0 ? 1 : total
        return values.map { value in
            let sweep = value / sum * 360
            let start = angle
            angle += sweep
            return (Angle(degrees: start), Angle(degrees: start + min(sweep, 359.99)))
        }
    }
}

/// The legend: a small square in the slot's colour, then the name, wrapping.
private struct FlowLegend: View {
    @Environment(\.themePalette) var themePalette
    let names: [String]

    var body: some View {
        // a plain flow, not a LazyVGrid: a lazy grid inside the transcript's lazy stack dropped
        // the whole message from the iPad's accessibility tree (VoiceOver and UI tests never saw it)
        ChatWidgetFlow(spacing: 10) {
            ForEach(Array(names.enumerated()), id: \.offset) { index, name in
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 2).fill(ChartPalette.color(index)).frame(width: 10, height: 10)
                        .accessibilityHidden(true)
                    Text(verbatim: name).lineLimit(1)
                }
                .font(.system(size: 11.5))
                .foregroundStyle(Theme.textSecondary)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Legend"))
    }
}
