// The model menu's right column and its segmented lines (#5051, the
// desktop's M-20261119-051). Every row ends its text on one edge, then a
// fixed icon zone: a 20 pt side slot and a 28 pt icon slot. The icon slot
// holds the one icon (the check, a star, or a chevron) so they share a
// centre. The side slot holds only the star of the model in use.
//
// Past four segments, the control takes balanced lines (seven read 4 and 3)
// so a label stays whole. The same split as src/components/SegmentedChoice.tsx.
import Foundation

public enum ModelMenuLayout {
    public static let sideSlot: CGFloat = 20
    public static let iconSlot: CGFloat = 28
    /// At most this many choices share one line.
    public static let segmentsPerLine = 4

    /// One line up to `perLine`, otherwise as few balanced lines as hold the
    /// choices. Seven read 4 and 3, eight 4 and 4, nine 3 and 3 and 3.
    public static func segmentLines<T>(_ items: [T], perLine: Int = segmentsPerLine) -> [[T]] {
        if items.count <= perLine { return [items] }
        let lineCount = (items.count + perLine - 1) / perLine
        let size = (items.count + lineCount - 1) / lineCount
        var lines: [[T]] = []
        var at = 0
        while at < items.count {
            let end = min(at + size, items.count)
            lines.append(Array(items[at..<end]))
            at = end
        }
        return lines
    }
}
