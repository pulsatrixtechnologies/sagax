// Plugin icons: one glyph tile per catalog icon key (shared/plugin-catalog.json
// `icon`). These are our own drawings, a symbol on a colour, never a copy of
// a service's logo. An entry the table does not know, and a server added on
// the computer, get the generic tile of the reference: #2B2B2D with a 1 px
// #363537 border and a white puzzle piece. A registry entry's or a connected
// app's own image (a URL the server hands over) is shown when there is one.
import CompanionCore
import SwiftUI

struct PluginGlyph {
    let symbol: String
    let background: Color
    var foreground: Color = .white

    /// Keyed by the catalog's icon key.
    static let catalog: [String: PluginGlyph] = [
        "notion": PluginGlyph(symbol: "doc.text", background: .white, foreground: .black),
        "linear": PluginGlyph(symbol: "checklist", background: Color(hex: 0x5E6AD2)),
        "atlassian": PluginGlyph(symbol: "square.stack.3d.up.fill", background: Color(hex: 0x1868DB)),
        "asana": PluginGlyph(symbol: "circle.grid.cross.fill", background: Color(hex: 0xF06A6A)),
        "sentry": PluginGlyph(symbol: "exclamationmark.triangle", background: Color(hex: 0x362D59)),
        "stripe": PluginGlyph(symbol: "creditcard.fill", background: Color(hex: 0x635BFF)),
        "vercel": PluginGlyph(symbol: "triangle.fill", background: .black),
        "figma": PluginGlyph(symbol: "pencil.and.outline", background: Color(hex: 0x1E1E1E)),
        "canva": PluginGlyph(symbol: "paintbrush.pointed.fill", background: Color(hex: 0x00A8B5)),
        "higgsfield": PluginGlyph(symbol: "film.stack", background: Color(hex: 0x151515), foreground: Color(hex: 0xD7F75B)),
        "supabase": PluginGlyph(symbol: "bolt.fill", background: Color(hex: 0x1C1C1C), foreground: Color(hex: 0x3ECF8E)),
        "neon": PluginGlyph(symbol: "cylinder.split.1x2.fill", background: Color(hex: 0x0C0D0D), foreground: Color(hex: 0x00E599)),
        "paypal": PluginGlyph(symbol: "dollarsign", background: Color(hex: 0x003087)),
        "intercom": PluginGlyph(symbol: "bubble.left.and.bubble.right.fill", background: Color(hex: 0x1F8DED)),
        "huggingface": PluginGlyph(symbol: "face.smiling", background: Color(hex: 0xFFD21E), foreground: Color(hex: 0x3A2E05)),
        "context7": PluginGlyph(symbol: "books.vertical.fill", background: Color(hex: 0x0E7C66)),
        "deepwiki": PluginGlyph(symbol: "book.pages.fill", background: Color(hex: 0x2B4FD8)),
        "cloudflare": PluginGlyph(symbol: "cloud.fill", background: Color(hex: 0xF38020)),
    ]
}

struct PluginIconTile: View {
    @Environment(\.themePalette) var themePalette
    var key: String?
    var remote: String?
    var size: CGFloat = 38.5
    /// The "N installed" capsule stacks them as circles.
    var circle = false

    init(key: String?, remote: String? = nil, size: CGFloat = 38.5, circle: Bool = false) {
        self.key = key
        self.remote = remote
        self.size = size
        self.circle = circle
    }

    init(installed plugin: InstalledPlugin, size: CGFloat, circle: Bool = false) {
        switch plugin {
        case let .mcp(_, _, _, _, _, icon, catalogId):
            self.init(key: icon ?? catalogId, size: size, circle: circle)
        }
    }

    private var shape: AnyShape {
        circle ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: size * 11.5 / 38.5, style: .continuous))
    }

    var body: some View {
        Group {
            if let glyph = key.flatMap({ PluginGlyph.catalog[$0] }) {
                ZStack {
                    glyph.background
                    Image(systemName: glyph.symbol)
                        .font(.system(size: size * 0.5, weight: .semibold))
                        .foregroundStyle(glyph.foreground)
                }
            } else if let remote, let url = URL(string: remote), url.scheme == "https" {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        ZStack { Color.white; image.resizable().scaledToFit().padding(size * 0.14) }
                    } else {
                        generic
                    }
                }
            } else {
                generic
            }
        }
        .frame(width: size, height: size)
        .clipShape(shape)
        .overlay(shape.stroke(circle ? Theme.bg : Color.clear, lineWidth: circle ? 1 : 0))
        .accessibilityHidden(true)
    }

    private var generic: some View {
        ZStack {
            Theme.pill
            shape.stroke(Theme.pillBorder, lineWidth: 1)
            Image(systemName: "puzzlepiece.extension")
                .font(.system(size: size * 0.55, weight: .regular))
                .foregroundStyle(Theme.textPrimary)
        }
    }
}
