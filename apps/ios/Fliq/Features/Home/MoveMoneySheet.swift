import SwiftUI

/// What the middle of the action bar opens: send, receive or request, each leading to its own screen.
struct MoveMoneySheet: View {
    let onSend: () -> Void
    let onReceive: () -> Void
    let onRequest: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .bold))
                        .frame(width: 36, height: 36)
                        .foregroundStyle(Theme.textPrimary)
                        .fliqGlass(Circle(), interactive: true)
                }
                .accessibilityLabel("Close")
            }
            .padding(.top, 20)

            Image(systemName: "arrow.up.arrow.down")
                .font(.system(size: 30, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 72, height: 72)
                .fliqGlass(Circle())
            Text("What do you want to do?")
                .font(.system(size: 24, weight: .bold))
                .tracking(-0.4)
                .padding(.top, 18)

            VStack(spacing: 10) {
                SheetRow(title: "Send", detail: "Bank, mobile money or fliq", action: onSend) {
                    Image(systemName: "paperplane").font(.system(size: 20))
                }
                SheetRow(title: "Receive", detail: "Your name, or any coin", action: onReceive) {
                    Image(systemName: "square.and.arrow.down").font(.system(size: 20))
                }
                SheetRow(title: "Request", detail: "A link anyone can pay", action: onRequest) {
                    Image(systemName: "link").font(.system(size: 20))
                }
            }
            .padding(.top, 28)
            Spacer(minLength: 12)
        }
        .padding(.horizontal, 16)
    }
}
