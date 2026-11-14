// Paints a shape skin on the body's face (#4159, item 4): `SkinFace` and the
// `under` and `around` groups of `ShapeSvg` in src/components/ShapeMascot.tsx,
// from the layers `ShapeSkinLayers` ports. Every call takes a context whose
// coordinates are the face's own 0..100 box (the engine's face projection,
// or the native volume's face matrix), so the layers sit on any outline.
import CompanionCore
import SwiftUI

enum ShapeSkinPainter {
    /// Behind the body: the skin's aura (`layers.under`).
    static func under(_ layers: ShapeSkinLayers, face: Path, rule: FillStyle, in ctx: GraphicsContext) {
        for mark in layers.under { draw(mark, face: face, rule: rule, in: ctx) }
    }

    /// The face itself: the skin's fill, the base stroke unless the skin draws
    /// its own edge, the shine, the inner layers clipped to the face, the edge.
    /// `outline` is the body's outline alone when `face` has holes cut in it (a flat body's eyes): the edge follows it.
    static func face(_ layers: ShapeSkinLayers, paint: ShapeArt.Paint, face: Path, rule: FillStyle, outline: Path? = nil, in ctx: GraphicsContext) {
        fill(face, layers.fill, rule: rule, in: ctx)
        if !layers.ownEdge, let stroke = paint.stroke {
            ctx.stroke(face, with: .color(Color(hex: stroke)), style: StrokeStyle(lineWidth: paint.strokeWidth, lineJoin: .round))
        }
        if paint.shine {
            let g = Gradient(stops: [
                .init(color: .white.opacity(0.55), location: 0),
                .init(color: .white.opacity(0.08), location: 0.45),
                .init(color: .black.opacity(0.18), location: 1),
            ])
            inUnitBox(face, rule: rule, in: ctx) { .radialGradient(g, center: CGPoint(x: 0.32, y: 0.26), startRadius: 0, endRadius: 0.75) }
        }
        if !layers.inner.isEmpty {
            var clipped = ctx
            clipped.clip(to: face, style: rule)
            for mark in layers.inner { draw(mark, face: face, rule: rule, in: clipped) }
        }
        for mark in layers.edge { draw(mark, face: outline ?? face, rule: outline == nil ? rule : FillStyle(), in: ctx) }
    }

    /// Over everything, the eyes included: the skin's particles (`layers.around`).
    static func around(_ layers: ShapeSkinLayers, face: Path, rule: FillStyle, in ctx: GraphicsContext) {
        for mark in layers.around { draw(mark, face: face, rule: rule, in: ctx) }
    }

    // MARK: marks

    private static func figure(_ figure: ShapeSkinLayers.Figure, face: Path) -> Path {
        switch figure {
        case .face: return face
        case let .path(d): return Path(SVGPath.cached(d))
        case let .rect(rect, corner): return corner > 0 ? Path(roundedRect: rect, cornerRadius: corner) : Path(rect)
        case let .ellipse(rect): return Path(ellipseIn: rect)
        case let .circle(center, radius): return Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: 2 * radius, height: 2 * radius))
        }
    }

    private static func draw(_ mark: ShapeSkinLayers.Mark, face: Path, rule: FillStyle, in context: GraphicsContext) {
        var ctx = context
        ctx.opacity *= mark.opacity
        if mark.blur > 0 { ctx.addFilter(.blur(radius: mark.blur)) }
        ctx.concatenate(mark.transform)
        let path = figure(mark.figure, face: face)
        let style = mark.figure == .face ? rule : FillStyle()
        if let ink = mark.fill { fill(path, ink, rule: style, in: ctx) }
        if let ink = mark.stroke {
            let line = StrokeStyle(lineWidth: mark.lineWidth, lineCap: mark.roundCap ? .round : .butt, lineJoin: .round)
            ctx.stroke(path, with: shading(ink, over: path.boundingRect), style: line)
        }
    }

    // MARK: inks

    private static func gradient(_ stops: [ShapeSkinLayers.Stop]) -> Gradient {
        Gradient(stops: stops.map { .init(color: Color(hex: $0.color, opacity: $0.opacity), location: $0.offset) })
    }

    /// An ink as a shading over a figure's bounding box (SVG's `objectBoundingBox` for the box units).
    private static func shading(_ ink: ShapeSkinLayers.Ink, over box: CGRect) -> GraphicsContext.Shading {
        switch ink {
        case let .solid(hex, opacity):
            return .color(Color(hex: hex, opacity: opacity))
        case let .linear(stops, from, to, inBox, repeats):
            let at = { (p: CGPoint) in inBox ? CGPoint(x: box.minX + p.x * box.width, y: box.minY + p.y * box.height) : p }
            return .linearGradient(gradient(stops), startPoint: at(from), endPoint: at(to), options: repeats ? .repeat : [])
        case let .radial(stops, center, radius):
            // only a stroke lands here (fills go through the unit box): a circle on the box's larger side
            let c = CGPoint(x: box.minX + center.x * box.width, y: box.minY + center.y * box.height)
            return .radialGradient(gradient(stops), center: c, startRadius: 0, endRadius: radius * max(box.width, box.height))
        }
    }

    /// Fills a path with an ink; a radial one is laid out in the path's unit box, an ellipse as SVG draws it.
    private static func fill(_ path: Path, _ ink: ShapeSkinLayers.Ink, rule: FillStyle, in ctx: GraphicsContext) {
        if case let .radial(stops, center, radius) = ink {
            inUnitBox(path, rule: rule, in: ctx) { .radialGradient(gradient(stops), center: center, startRadius: 0, endRadius: radius) }
        } else {
            ctx.fill(path, with: shading(ink, over: path.boundingRect), style: rule)
        }
    }

    /// Fills a path with a shading laid out in its bounding box's unit square (SVG's `objectBoundingBox`).
    private static func inUnitBox(_ path: Path, rule: FillStyle, in context: GraphicsContext, shading: () -> GraphicsContext.Shading) {
        let box = path.boundingRect
        guard box.width > 0, box.height > 0 else { return }
        var ctx = context
        ctx.translateBy(x: box.minX, y: box.minY)
        ctx.scaleBy(x: box.width, y: box.height)
        let unit = path.applying(CGAffineTransform(scaleX: 1 / box.width, y: 1 / box.height).translatedBy(x: -box.minX, y: -box.minY))
        ctx.fill(unit, with: shading(), style: rule)
    }
}
