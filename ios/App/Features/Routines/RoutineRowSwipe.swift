// Trailing swipe on a profile routine row reveals Delete (Lot 5). Rows live
// in a ScrollView / ProfileCard, so SwiftUI `.swipeActions` (List only)
// cannot apply; same offset + drag pattern as SidebarPinSwipe.
import CompanionCore
import SwiftUI

struct RoutineDeleteSwipe: ViewModifier {
    let enabled: Bool
    let label: String
    let onDelete: () -> Void
    @State private var offset: CGFloat = 0

    func body(content: Content) -> some View {
        if !enabled {
            content
        } else {
            content
                .offset(x: offset)
                .background(alignment: .trailing) {
                    if SidebarBotPinning.actionVisible(offset: Double(offset)) {
                        Button {
                            onDelete()
                            withAnimation(.snappy(duration: 0.2)) { offset = 0 }
                        } label: {
                            Text("Delete")
                                .font(Theme.Font.labelMedium)
                                .foregroundStyle(.white)
                                .frame(width: CGFloat(SidebarBotPinning.revealDistance))
                                .frame(maxHeight: .infinity)
                                .background(Theme.danger)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Delete \(label)"))
                        .accessibilityIdentifier("profile-routine-swipe-delete.\(label)")
                        .frame(width: CGFloat(SidebarBotPinning.actionWidth(offset: Double(offset))), alignment: .leading)
                        .clipped()
                    }
                }
                .clipped()
                .simultaneousGesture(
                    DragGesture(minimumDistance: 24, coordinateSpace: .local)
                        .onChanged { value in
                            let dx = Double(value.translation.width)
                            let dy = Double(value.translation.height)
                            guard abs(dx) > abs(dy) else { return }
                            offset = CGFloat(SidebarBotPinning.clampedOffset(dx))
                        }
                        .onEnded { value in
                            let dx = Double(value.translation.width)
                            let dy = Double(value.translation.height)
                            withAnimation(.snappy(duration: 0.2)) {
                                offset = SidebarBotPinning.swipeRevealsAction(horizontal: dx, vertical: dy)
                                    ? -CGFloat(SidebarBotPinning.revealDistance)
                                    : 0
                            }
                        }
                )
        }
    }
}

extension View {
    func routineDeleteSwipe(enabled: Bool, label: String, onDelete: @escaping () -> Void) -> some View {
        modifier(RoutineDeleteSwipe(enabled: enabled, label: label, onDelete: onDelete))
    }
}
