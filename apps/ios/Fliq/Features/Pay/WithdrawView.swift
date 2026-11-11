import SwiftUI
import UIKit

struct WithdrawView: View {
    @Bindable var flow: WithdrawFlow
    let onDone: () -> Void
    @FocusState private var addressFocused: Bool
    @FocusState private var amountFocused: Bool

    var body: some View {
        Group {
            if let sent = flow.sent {
                done(sent)
            } else {
                sending
            }
        }
        .fliqScreen("Send to a wallet", aurora: Aurora(strength: 0.55))
    }

    private var sending: some View {
        VStack(spacing: 0) {
            addressField.padding(.top, 20)
            statusLine.frame(minHeight: 44).padding(.top, 8)
            Spacer(minLength: 8)
            AmountInput(text: flow.amountText, onType: flow.enterAmount, isFocused: $amountFocused) {
                ViewThatFits(in: .vertical) {
                    amount
                    compactAmount
                }
            }
            Spacer(minLength: 8)
            if let message = flow.errorMessage {
                Text(message)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.warning)
                    .multilineTextAlignment(.center)
                    .padding(.bottom, 8)
            }
            Button { Task { await flow.send() } } label: {
                if flow.isSending {
                    ProgressView().tint(.black)
                } else {
                    Label("Send $\(Money.dollars(flow.amount ?? .zero)) with Face ID", systemImage: "faceid")
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!flow.canSend)
            .padding(.bottom, 12)
        }
        .task(id: flow.addressText) { await flow.checkAddress() }
        .onAppear { addressFocused = true }
    }

    private var addressField: some View {
        HStack(spacing: 10) {
            TextField("NEAR address", text: $flow.addressText)
                .focused($addressFocused)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .submitLabel(.next)
                .onSubmit { amountFocused = true }
                .font(.system(size: 17, weight: .medium, design: .monospaced))
                .lineLimit(1)
            if flow.addressText.isEmpty {
                Button("Paste") {
                    flow.addressText = UIPasteboard.general.string ?? ""
                    amountFocused = true
                }
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
                .padding(.horizontal, 12)
                .frame(height: 32)
                .background(Theme.surfaceRaised, in: Capsule())
            }
        }
        .padding(.horizontal, 18)
        .frame(height: 60)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        .overlay {
            RoundedRectangle(cornerRadius: 16).strokeBorder(isReady ? Theme.confirmed : Theme.hairline)
        }
    }

    @ViewBuilder
    private var statusLine: some View {
        HStack(alignment: .top, spacing: 10) {
            if flow.isChecking {
                ProgressView().controlSize(.small)
                Text("Checking the address").foregroundStyle(Theme.textSecondary)
            } else {
                switch flow.check {
                case .ready(let needsSetup):
                    Image(systemName: "checkmark.circle").foregroundStyle(Theme.confirmed)
                    Text(needsSetup ? "NEAR wallet found. It hasn't held USDC before, so fliq sets that up in the same step." : "NEAR wallet found")
                        .foregroundStyle(Theme.confirmed)
                case .invalid(let problem) where !problem.isEmpty:
                    Image(systemName: "exclamationmark.circle").foregroundStyle(Theme.warning)
                    Text(problem).foregroundStyle(Theme.warning)
                case .unavailable:
                    Image(systemName: "wifi.exclamationmark").foregroundStyle(Theme.warning)
                    Text("Couldn't check the address. Try again in a moment.").foregroundStyle(Theme.warning)
                default:
                    Image(systemName: "info.circle.fill").foregroundStyle(Theme.warning)
                    Text("Only send to a NEAR address. Money sent to another network can't come back.")
                        .fontWeight(.medium)
                        .foregroundStyle(Theme.warning)
                }
            }
            Spacer(minLength: 0)
        }
        .font(.system(size: 14))
        .fixedSize(horizontal: false, vertical: true)
        .padding(flow.check == nil && !flow.isChecking ? 14 : 4)
        .background(flow.check == nil && !flow.isChecking ? Theme.warning.opacity(0.1) : .clear, in: RoundedRectangle(cornerRadius: 14))
    }

    private var amount: some View {
        VStack(spacing: 12) {
            Text("They receive")
                .font(.system(size: 15))
                .foregroundStyle(Theme.textSecondary)
            HeroAmount(symbol: "$", value: Money.dollars(flow.amount ?? .zero))
            Label("USDC on NEAR · fee under $0.01", systemImage: "arrow.up.right")
                .font(.system(size: 15))
                .foregroundStyle(Theme.textSecondary)
                .padding(.horizontal, 16)
                .frame(height: 40)
                .overlay(Capsule().strokeBorder(Theme.hairline))
            vaultLine.padding(.top, 4)
        }
    }

    private var compactAmount: some View {
        VStack(spacing: 4) {
            HeroAmount(symbol: "$", value: Money.dollars(flow.amount ?? .zero), size: 48)
            vaultLine
        }
    }

    private var vaultLine: some View {
        HStack(spacing: 8) {
            Text("In your vault $\(Money.dollars(flow.available))")
                .foregroundStyle(Theme.textTertiary)
            Button("Send all", action: flow.useEverything)
                .fontWeight(.semibold)
                .foregroundStyle(Theme.textPrimary)
                .disabled(flow.available == .zero)
        }
        .font(.system(size: 14))
    }

    private func done(_ sent: WithdrawFlow.Sent) -> some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "checkmark")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(.black)
                .frame(width: 72, height: 72)
                .background(Theme.confirmed, in: Circle())
            Text("Sent")
                .font(.system(size: 16))
                .foregroundStyle(Theme.textSecondary)
            HeroAmount(symbol: "$", value: Money.dollars(sent.amount))
            DetailCard {
                DetailRow("To", Self.short(sent.address))
                DetailRow("Network", "USDC on NEAR")
                DetailRow("Fee", "Under $0.01", isLast: true)
            }
            .padding(.top, 12)
            if let explorer = sent.explorer {
                Link(destination: explorer) {
                    Label("View on NEAR", systemImage: "arrow.up.right.square")
                        .font(.system(size: 15, weight: .medium))
                }
                .foregroundStyle(Theme.textPrimary)
                .padding(.top, 4)
            }
            Spacer()
            Button("Done", action: onDone)
                .buttonStyle(PrimaryButtonStyle())
                .padding(.bottom, 12)
        }
    }

    private static func short(_ address: String) -> String {
        address.count > 22 ? "\(address.prefix(10))…\(address.suffix(8))" : address
    }

    private var isReady: Bool {
        if case .ready = flow.check { true } else { false }
    }
}

#Preview {
    NavigationStack {
        WithdrawView(flow: WithdrawFlow(withdrawals: FixtureWithdrawals(), vault: VaultStore(balance: TokenAmount(baseUnits: 20_000_000))), onDone: {})
    }
    .environment(AppEnvironment.preview)
}
