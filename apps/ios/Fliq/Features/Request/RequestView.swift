import SwiftUI
import UIKit

struct RequestView: View {
    @Bindable var flow: RequestFlow
    let onDone: () -> Void
    @State private var copied = false
    @FocusState private var noteFocused: Bool

    var body: some View {
        Group {
            if let request = flow.request {
                link(request)
                    .task { await flow.watch() }
            } else {
                asking
            }
        }
        .fliqScreen("Request", aurora: Aurora(strength: 0.45))
        .sensoryFeedback(.success, trigger: flow.request?.state) { _, state in state == .paid }
    }

    private var asking: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 12) {
                Text("You ask for").font(.system(size: 15)).foregroundStyle(Theme.textSecondary)
                HeroAmount(symbol: "$", value: flow.amountText.isEmpty ? "0" : flow.amountText)
                    .contentShape(Rectangle())
                    .onTapGesture { noteFocused = false }
                TextField("", text: $flow.note, prompt: Text("What's it for?").foregroundStyle(Theme.textTertiary))
                    .multilineTextAlignment(.center)
                    .font(.system(size: 16))
                    .padding(.horizontal, 18)
                    .frame(height: 44)
                    .fliqGlass(Capsule())
                    .frame(maxWidth: 280)
                    .onChange(of: flow.note) { if flow.note.count > 120 { flow.note = String(flow.note.prefix(120)) } }
                    .focused($noteFocused)
                    .submitLabel(.done)
            }
            Spacer()
            if !noteFocused {
                AmountKeypad(text: flow.amountText, onType: flow.enterAmount)
                    .padding(.bottom, 8)
            }
            Toggle("Cash out to my bank when it lands", isOn: $flow.cashOutOnArrival)
                .tint(Theme.confirmed)
                .font(.system(size: 15))
                .padding(.horizontal, 16)
                .frame(height: 52)
                .background(Theme.field, in: RoundedRectangle(cornerRadius: 14))
                .padding(.bottom, 10)
            if let message = flow.errorMessage {
                Text(message).font(.system(size: 13)).foregroundStyle(Theme.warning).padding(.bottom, 8)
            }
            Button { Task { await flow.create() } } label: {
                if flow.isCreating { ProgressView().tint(.black) } else { Text("Make a pay link") }
            }
            .buttonStyle(PrimaryButtonStyle(filled: true))
            .disabled(!flow.canCreate)
            .padding(.bottom, 12)
        }
    }

    private func link(_ request: PaymentRequest) -> some View {
        VStack(spacing: 0) {
            VStack(spacing: 6) {
                Text(request.state == .paid ? "Paid" : "Waiting for payment")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(request.state == .paid ? Theme.confirmed : Theme.textSecondary)
                HeroAmount(symbol: "$", value: request.amount)
                if !request.note.isEmpty {
                    Text(request.note).font(.system(size: 15)).foregroundStyle(Theme.textSecondary)
                }
            }
            .padding(.top, 24)

            VStack(spacing: 16) {
                if let paid = request.paid {
                    Icon("checkmark", size: 41)
                        .foregroundStyle(.black)
                        .frame(width: 96, height: 96)
                        .background(Theme.confirmed, in: Circle())
                    Text("$\(paid.landed) landed in your vault")
                        .font(.system(size: 16, weight: .semibold))
                    Text(paid.payer.map { "from \($0) · \(paid.token) on \(paid.chain)" } ?? "\(paid.token) on \(paid.chain)")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textSecondary)
                } else {
                    QRCode(text: request.link, color: .white) {
                        Icon("link", size: 22)
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(Color(hex: 0x1C1C1C), in: Circle())
                    }
                    .frame(width: 200, height: 200)
                    Text(request.link.replacingOccurrences(of: "https://", with: ""))
                        .font(.system(size: 14, design: .monospaced))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Text("Anyone can pay it from any chain. It lands in your vault as dollars.")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textTertiary)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity)
            .fliqGlass(RoundedRectangle(cornerRadius: 28))
            .padding(.top, 24)

            Spacer()

            if request.state == .paid {
                Button("Done", action: onDone).buttonStyle(PrimaryButtonStyle(filled: true)).padding(.bottom, 12)
            } else {
                HStack(spacing: 10) {
                    Button {
                        UIPasteboard.general.string = request.link
                        copied = true
                    } label: {
                        IconLabel(copied ? "Copied" : "Copy link", icon: copied ? "checkmark" : "doc.on.doc")
                    }
                    .buttonStyle(PrimaryButtonStyle(filled: true))
                    ShareLink(item: URL(string: request.link) ?? URL(string: "https://fliq.cash")!, message: Text(request.note.isEmpty ? "Pay me on fliq" : request.note)) {
                        Icon("square.and.arrow.up", size: 22)
                            .frame(width: 56, height: 56)
                            .fliqGlass(Circle(), interactive: true)
                    }
                    .accessibilityLabel("Share link")
                }
                .padding(.bottom, 12)
            }
        }
    }
}
