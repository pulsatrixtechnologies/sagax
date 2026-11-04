// The desktop's provider marks (ProviderIcons.tsx): a model's brand in
// front of its name. The shapes are ProviderMarkData (generated from the
// desktop's SVGs); an instance's preset or custom image wins, as
// InstanceProviderMark; an unknown driver shows its first letter.
import SwiftUI
import UIKit
import CompanionCore

struct ProviderMarkView: View {
    @Environment(\.desktopTheme) private var theme
    let driverKind: String
    var preset: String?
    var dataUrl: String?
    var size: CGFloat = 13

    init(instance: Instance, size: CGFloat = 13) {
        driverKind = instance.driverKind
        preset = instance.icon?.kind == "preset" ? instance.icon?.preset : nil
        dataUrl = instance.icon?.kind == "custom" ? instance.icon?.dataUrl : nil
        self.size = size
    }

    init(driverKind: String, size: CGFloat = 13) {
        self.driverKind = driverKind
        self.size = size
    }

    private var mark: ProviderMarkData.Mark? {
        if let preset {
            if let named = ProviderMarkData.presetAlias[preset] { return ProviderMarkData.marks[named] }
            if let mark = ProviderMarkData.presets[preset] { return mark }
        }
        guard let target = ProviderMarkData.drivers[driverKind] else { return nil }
        if target.hasPrefix("preset:") { return ProviderMarkData.presets[String(target.dropFirst(7))] }
        return ProviderMarkData.marks[target]
    }

    private var custom: UIImage? {
        guard let dataUrl, let comma = dataUrl.firstIndex(of: ","), dataUrl.hasPrefix("data:image/"),
              let data = Data(base64Encoded: String(dataUrl[dataUrl.index(after: comma)...])) else { return nil }
        return UIImage(data: data)
    }

    var body: some View {
        Group {
            if let custom {
                Image(uiImage: custom).resizable().scaledToFit()
            } else if let mark {
                Canvas { context, canvas in
                    let box = mark.viewBox
                    let scale = min(canvas.width / box.width, canvas.height / box.height)
                    context.translateBy(x: (canvas.width - box.width * scale) / 2, y: (canvas.height - box.height * scale) / 2)
                    context.scaleBy(x: scale, y: scale)
                    context.translateBy(x: -box.minX, y: -box.minY)
                    for shape in mark.paths {
                        let colour = shape.fill == "ink" ? theme.ink : (Color(graphHex: shape.fill) ?? theme.ink)
                        context.fill(Path(SVGPath.cached(shape.d)), with: .color(colour), style: FillStyle(eoFill: shape.evenOdd))
                    }
                }
            } else {
                Text(verbatim: String(driverKind.replacingOccurrences(of: "Agent", with: "").prefix(1)).uppercased().isEmpty ? "?" : String(driverKind.replacingOccurrences(of: "Agent", with: "").prefix(1)).uppercased())
                    .font(theme.font(max(8, size * 0.75), .semibold))
                    .foregroundStyle(theme.inkSecondary)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
