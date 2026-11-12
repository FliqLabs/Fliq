import SwiftUI
import UIKit

/// Step 1 of Send to a wallet: how much.
struct WithdrawAmountView: View {
    let flow: WithdrawFlow
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 10) {
                HeroAmount(symbol: "$", value: flow.amountText.isEmpty ? "0" : flow.amountText)
                Text("\(WithdrawFlow.cents(flow.amount ?? .zero)) USDC")
                    .font(.system(size: 15, design: .monospaced))
                    .foregroundStyle(Theme.textTertiary)
            }
            Spacer()
            Button(action: flow.useEverything) {
                HStack(spacing: 8) {
                    Circle().fill(flow.isOverBalance ? Theme.warning : Theme.textPrimary).frame(width: 7, height: 7)
                    Text(flow.isOverBalance ? "More than your vault" : "Vault").foregroundStyle(Theme.textSecondary)
                    Text("·").foregroundStyle(Theme.textTertiary)
                    Text("$\(WithdrawFlow.cents(flow.available))").fontWeight(.semibold)
                }
                .font(.system(size: 15))
                .foregroundStyle(Theme.textPrimary)
                .padding(.horizontal, 16)
                .frame(height: 40)
                .overlay(Capsule().strokeBorder(flow.isOverBalance ? Theme.warning : Theme.hairline))
            }
            .accessibilityHint("Sends everything in your vault")
            .padding(.bottom, 8)
            AmountKeypad(text: flow.amountText, onType: flow.enterAmount)
                .padding(.bottom, 12)
            Button("Next") { environment.router.push(.withdrawTo) }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!flow.hasAmount)
                .padding(.bottom, 12)
        }
        .fliqScreen("Send")
    }
}

/// Step 2: which wallet. Paste or type an address, or pick one sent to before.
struct WithdrawToView: View {
    @Bindable var flow: WithdrawFlow
    @Environment(AppEnvironment.self) private var environment
    @FocusState private var addressFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            toCard.padding(.top, 16)
            status.padding(.top, 12)
            if !flow.recentAddresses.isEmpty {
                Text("Recent")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.top, 28)
                    .padding(.leading, 4)
                recents.padding(.top, 10)
            }
            Spacer(minLength: 12)
            Button("Next") { environment.router.push(.withdrawReview) }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!flow.hasAddress)
                .padding(.bottom, 12)
        }
        .fliqScreen("Send to")
        .task(id: flow.addressText) { await flow.checkAddress() }
        .onAppear { if flow.addressText.isEmpty { addressFocused = true } }
    }

    private var toCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("To")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
            HStack(spacing: 10) {
                TextField("name.near or address", text: $flow.addressText)
                    .focused($addressFocused)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.asciiCapable)
                    .textContentType(.none)
                    .submitLabel(.next)
                    .onSubmit { if flow.hasAddress { environment.router.push(.withdrawReview) } }
                    .font(.system(size: 17, weight: .medium, design: .monospaced))
                    .lineLimit(1)
                if flow.addressText.isEmpty {
                    Button("Paste") { flow.pick(UIPasteboard.general.string ?? "") }
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                        .padding(.horizontal, 12)
                        .frame(height: 32)
                        .background(Theme.surfaceRaised, in: Capsule())
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20).strokeBorder(flow.hasAddress ? Theme.confirmed : Theme.hairline)
        }
    }

    @ViewBuilder
    private var status: some View {
        HStack(alignment: .top, spacing: 10) {
            if flow.isChecking {
                ProgressView().controlSize(.small)
                Text("Checking the address").foregroundStyle(Theme.textSecondary)
            } else {
                switch flow.check {
                case .ready(let needsSetup):
                    Icon("checkmark.circle", size: 18).foregroundStyle(Theme.confirmed)
                    Text(needsSetup ? "NEAR wallet found. It hasn't held USDC before, so fliq sets that up in the same step." : "NEAR wallet found")
                        .foregroundStyle(Theme.confirmed)
                case .invalid(let problem) where !problem.isEmpty:
                    Icon("exclamationmark.circle", size: 18).foregroundStyle(Theme.warning)
                    Text(problem).foregroundStyle(Theme.warning)
                case .unavailable:
                    Icon("wifi.exclamationmark", size: 18).foregroundStyle(Theme.warning)
                    Text("Couldn't check the address. Try again in a moment.").foregroundStyle(Theme.warning)
                default:
                    Icon("info.circle.fill", size: 18).foregroundStyle(Theme.warning)
                    Text("Only send to a NEAR address. Money sent to another network can't come back.")
                        .fontWeight(.medium)
                        .foregroundStyle(Theme.warning)
                }
            }
            Spacer(minLength: 0)
        }
        .font(.system(size: 14))
        .fixedSize(horizontal: false, vertical: true)
        .padding(isWarning ? 14 : 4)
        .background(isWarning ? Theme.warning.opacity(0.1) : .clear, in: RoundedRectangle(cornerRadius: 14))
    }

    private var recents: some View {
        VStack(spacing: 0) {
            ForEach(flow.recentAddresses) { entry in
                Button { flow.pick(entry.address) } label: {
                    HStack(spacing: 14) {
                        WalletAvatar(address: entry.address)
                        Text(WithdrawAddress.short(entry.address))
                            .font(.system(size: 15, design: .monospaced))
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                        Spacer()
                        Text("\(entry.count) sent")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textTertiary)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .overlay(alignment: .bottom) {
                    if entry != flow.recentAddresses.last {
                        Rectangle().fill(Theme.hairline).frame(height: 1).padding(.leading, 74)
                    }
                }
            }
        }
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20))
    }

    private var isWarning: Bool { flow.check == nil && !flow.isChecking }
}

/// Step 3: check everything, then sign once with Face ID.
struct WithdrawReviewView: View {
    let flow: WithdrawFlow
    let onDone: () -> Void

    var body: some View {
        Group {
            if let sent = flow.sent {
                done(sent)
            } else {
                review
            }
        }
        .fliqScreen(flow.sent == nil ? "Review" : "")
        .navigationBarBackButtonHidden(flow.sent != nil)
    }

    private var review: some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                Text("You send")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textSecondary)
                HeroAmount(symbol: "$", value: Money.dollars(flow.amount ?? .zero))
            }
            .padding(.top, 36)
            DetailCard {
                DetailRow("To", WithdrawAddress.short(flow.address))
                DetailRow("Network", "USDC on NEAR")
                DetailRow("Fee", "Free")
                DetailRow("Arrives", "In a few seconds", isLast: true)
            }
            .padding(.top, 32)
            Spacer(minLength: 12)
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
                    IconLabel("Send with Face ID", icon: "faceid")
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!flow.canSend)
            .padding(.bottom, 12)
        }
    }

    private func done(_ sent: WithdrawFlow.Sent) -> some View {
        VStack(spacing: 14) {
            Spacer()
            Icon("checkmark", size: 34)
                .foregroundStyle(.black)
                .frame(width: 72, height: 72)
                .background(Theme.confirmed, in: Circle())
            Text("Sent")
                .font(.system(size: 16))
                .foregroundStyle(Theme.textSecondary)
            HeroAmount(symbol: "$", value: Money.dollars(sent.amount))
            DetailCard {
                DetailRow("To", WithdrawAddress.short(sent.address))
                DetailRow("Network", "USDC on NEAR", isLast: true)
            }
            .padding(.top, 12)
            if let explorer = sent.explorer {
                Link(destination: explorer) {
                    IconLabel("View on NEAR", icon: "arrow.up.right.square")
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
}

/// A colour drawn from the address, so the same wallet always looks the same in Recent.
private struct WalletAvatar: View {
    let address: String

    var body: some View {
        let hue = Double(address.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0xFFFF } % 360) / 360
        Circle()
            .fill(LinearGradient(
                colors: [Color(hue: hue, saturation: 0.55, brightness: 0.85), Color(hue: (hue + 0.12).truncatingRemainder(dividingBy: 1), saturation: 0.7, brightness: 0.6)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ))
            .frame(width: 44, height: 44)
    }
}

#Preview {
    NavigationStack {
        WithdrawAmountView(flow: WithdrawFlow(withdrawals: FixtureWithdrawals(), vault: VaultStore(balance: TokenAmount(baseUnits: 20_000_000))))
    }
    .environment(AppEnvironment.preview)
}
