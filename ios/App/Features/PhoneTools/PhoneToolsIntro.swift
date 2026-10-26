// Shown once, the first time this iPhone offers phone tools (review of
// #960): what the person's own bots may ask it for, that each request asks
// here first, and where each tool is turned off (Settings > Approval rules).
import CompanionCore
import SwiftUI

struct PhoneToolsIntro: View {
    let tools: [PhoneTool]
    let done: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Phone tools").font(.title3.bold())
            Text("Your own bots may ask this iPhone for these. Each request shows a card here first; nothing runs in the background, and only over a secure connection (HTTPS or Tailscale).")
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 8) {
                ForEach(tools) { tool in
                    Label(PhoneToolWords.name(tool), systemImage: PhoneToolWords.symbol(tool))
                }
            }
            Text("Turn any of them off in Settings > Approval rules.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            Button(action: done) { Text("OK").frame(maxWidth: .infinity) }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
        }
        .padding(20)
    }
}
