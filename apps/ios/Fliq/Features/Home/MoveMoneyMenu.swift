import SwiftUI

/// The first page of the money sheet: send, receive or request.
struct MoveMoneyMenu: View {
    let onSend: () -> Void
    let onReceive: () -> Void
    let onRequest: () -> Void
    var onScan: (() -> Void)?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
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
        .sheetToolbar { dismiss() }
        .toolbar {
            if let onScan {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: onScan) { Image(systemName: "qrcode.viewfinder") }
                        .accessibilityLabel("Scan to pay")
                }
            }
        }
    }
}
