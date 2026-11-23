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
                .contentShape(Capsule())
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
            if flow.networks.count > 1 { networkPicker.padding(.top, 16) }
            if let note = flow.minimumNote {
                Text(note)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.warning)
                    .padding(.top, 10)
                    .padding(.horizontal, 4)
            }
            toCard.padding(.top, flow.networks.count > 1 ? 12 : 16)
            status.padding(.top, 12)
            if flow.network.isNEAR, !flow.recentAddresses.isEmpty {
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
                .disabled(!flow.hasAddress || flow.isBelowMinimum)
                .padding(.bottom, 12)
        }
        .fliqScreen("Send to")
        .task { await flow.loadNetworks() }
        .task(id: "\(flow.network.chain)|\(flow.addressText)") { await flow.checkAddress() }
        .onAppear { if flow.addressText.isEmpty { addressFocused = true } }
    }

    /// One even row when every name fits, otherwise a row that scrolls sideways.
    private var networkPicker: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { networkPills(even: true) }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) { networkPills(even: false) }
            }
            .scrollClipDisabled()
        }
        .animation(.snappy(duration: 0.2), value: flow.network)
    }

    private func networkPills(even: Bool) -> some View {
        ForEach(flow.networks) { network in
            let picked = network == flow.network
            let tooSmall = flow.isBelowMinimum(for: network)
            Button { flow.network = network } label: {
                Text(network.name)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(picked ? .black : Theme.textPrimary)
                    .fixedSize()
                    .padding(.horizontal, 16)
                    .frame(maxWidth: even ? .infinity : nil, minHeight: 40)
                    .background(picked ? Color.white : Theme.surface, in: Capsule())
                    .contentShape(Capsule())
                    .opacity(tooSmall && !picked ? 0.4 : 1)
            }
            .buttonStyle(.pressable)
            .accessibilityValue(tooSmall ? "From $\(Money.dollars(network.minimumAmount))" : "")
            .accessibilityAddTraits(picked ? .isSelected : [])
            .accessibilityIdentifier("send.network.\(network.chain)")
        }
    }

    private var toCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("To")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
            HStack(spacing: 10) {
                TextField(flow.network.isNEAR ? "name.near or address" : "\(flow.network.name) address", text: $flow.addressText)
                    .focused($addressFocused)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.asciiCapable)
                    .textContentType(.none)
                    .submitLabel(.next)
                    .onSubmit { if flow.hasAddress, !flow.isBelowMinimum { environment.router.push(.withdrawReview) } }
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
                    Text(Self.found(flow.network, needsSetup: needsSetup))
                        .foregroundStyle(Theme.confirmed)
                case .invalid(let problem) where !problem.isEmpty:
                    Icon("exclamationmark.circle", size: 18).foregroundStyle(Theme.warning)
                    Text(problem).foregroundStyle(Theme.warning)
                case .unavailable:
                    Icon("wifi.exclamationmark", size: 18).foregroundStyle(Theme.warning)
                    Text("Couldn't check the address. Try again in a moment.").foregroundStyle(Theme.warning)
                default:
                    Icon("info.circle.fill", size: 18).foregroundStyle(Theme.warning)
                    Text("Only send to a \(flow.network.name) address. Money sent to the wrong network can't come back.")
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

    static func found(_ network: SendNetwork, needsSetup: Bool) -> String {
        guard network.isNEAR else { return "This looks like a \(network.name) address. Check it is the right one: a send can't be undone." }
        return needsSetup ? "NEAR wallet found. It hasn't held USDC before, so fliq sets that up in the same step." : "NEAR wallet found"
    }
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
                DetailRow("Network", "\(flow.network.tokenName) on \(flow.network.name)")
                if flow.network.isNEAR {
                    DetailRow("Fee", "Free")
                    DetailRow("Arrives", "In a few seconds", isLast: true)
                } else {
                    DetailRow("Network fee", flow.quote.map { "$" + Money.dollars($0.feeAmount) } ?? "…")
                    DetailRow("They receive", flow.quote.map { "$" + Money.dollars($0.receivesAmount) } ?? "…")
                    DetailRow("Arrives", flow.quote.map { Self.arrives($0.etaSeconds) } ?? "…", isLast: true)
                }
            }
            .padding(.top, 32)
            Spacer(minLength: 12)
            if flow.isBelowMinimum {
                Text("The smallest amount you can send to \(flow.network.name) is $\(Money.dollars(flow.network.minimumAmount)).")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.warning)
                    .multilineTextAlignment(.center)
                    .padding(.bottom, 8)
            } else if let message = flow.errorMessage {
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
        .task(id: "\(flow.amountText)|\(flow.network.chain)|\(flow.address)") { await flow.prepare() }
    }

    static func arrives(_ seconds: Int) -> String {
        seconds < 90 ? "In about a minute" : "In about \(Int((Double(seconds) / 60).rounded())) minutes"
    }

    /// Opens the moment Face ID passes. The ring turns until NEAR confirms the USDC reached the wallet.
    private func done(_ sent: WithdrawFlow.Sent) -> some View {
        ScrollView {
            VStack(spacing: 0) {
                ZStack(alignment: .bottomTrailing) {
                    WalletAvatar(address: sent.address, size: 76)
                        .padding(sent.delivered || sent.returned ? 0 : 6)
                        .overlay { if !sent.delivered, !sent.returned { SpinningRing() } }
                    if sent.delivered {
                        Icon("checkmark", size: 14)
                            .foregroundStyle(.black)
                            .frame(width: 28, height: 28)
                            .background(Theme.confirmed, in: Circle())
                            .overlay(Circle().strokeBorder(Theme.ground, lineWidth: 3))
                            .transition(.scale.combined(with: .opacity))
                    }
                }
                .animation(.spring(duration: 0.4), value: sent.delivered)
                .padding(.top, 40)

                Text(Self.headline(sent))
                    .font(.system(size: 18, weight: .medium))
                    .multilineTextAlignment(.center)
                    .padding(.top, 18)
                    .contentTransition(.opacity)
                HeroAmount(symbol: "$", value: Money.dollars(sent.amount))
                    .padding(.top, 4)
                Text(ActivityLine.time(sent.at))
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textSecondary)

                timeline(sent).padding(.top, 28)

                DetailCard {
                    DetailRow("To", WithdrawAddress.short(sent.address))
                    DetailRow("Network", "\(sent.network.tokenName) on \(sent.network.name)")
                    if let receives = sent.receives { DetailRow("They receive", "$" + Money.dollars(receives)) }
                    DetailRow(sent.network.isNEAR ? "Fee" : "Network fee", sent.fee.map { "$" + Money.dollars($0) } ?? "Free", isLast: true)
                }
                .padding(.top, 16)

                if sent.delivered {
                    HStack(spacing: 12) {
                        ReceiptShareButton(document: ReceiptDocument(sent: sent)) {
                            IconLabel("Share", icon: "square.and.arrow.up")
                                .frame(maxWidth: .infinity, minHeight: 50)
                                .background(Theme.surfaceRaised, in: Capsule())
                        }
                        if let explorer = sent.explorer {
                            Link(destination: explorer) {
                                IconLabel("View on \(sent.network.name)", icon: "arrow.up.right.square")
                                    .frame(maxWidth: .infinity, minHeight: 50)
                                    .background(Theme.surfaceRaised, in: Capsule())
                            }
                        }
                    }
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.top, 16)
                    .transition(.opacity)
                }
            }
            .padding(.horizontal, 4)
            .animation(.smooth(duration: 0.3), value: sent.delivered)
        }
        .scrollIndicators(.hidden)
        .safeAreaInset(edge: .bottom) {
            Button("Done", action: onDone)
                .buttonStyle(PrimaryButtonStyle())
                .padding(.bottom, 12)
        }
    }

    static func headline(_ sent: WithdrawFlow.Sent) -> String {
        let to = WithdrawAddress.short(sent.address)
        if sent.returned { return "Not delivered. Your money is back" }
        if sent.delivered { return "Sent to \(to)" }
        return sent.crossing ? "On its way to \(to)" : "Sending to \(to)"
    }

    private func timeline(_ sent: WithdrawFlow.Sent) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            step("Approved with Face ID", detail: ActivityLine.time(sent.at), done: true, last: false)
            if !sent.network.isNEAR {
                step("Left your account", detail: sent.crossing ? "On its way to \(sent.network.name)" : "A few seconds", done: sent.crossing, last: false)
            }
            if sent.returned {
                step("Back in your fliq wallet", detail: "\(sent.network.name) couldn't take it. Add it to your vault from Home.", done: true, last: true)
            } else {
                step(
                    sent.delivered ? "Delivered to \(WithdrawAddress.short(sent.address))" : "Landing on \(sent.network.name)",
                    detail: sent.delivered ? "In their wallet now" : sent.network.isNEAR ? "Usually a few seconds" : "About a minute. You don't need to wait here.",
                    done: sent.delivered,
                    last: true
                )
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
    }

    private func step(_ title: String, detail: String, done: Bool, last: Bool) -> some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(spacing: 4) {
                if done {
                    Circle().fill(Theme.confirmed).frame(width: 8, height: 8).padding(.top, 7)
                } else {
                    ProgressView().controlSize(.mini).frame(width: 8, height: 8).padding(.top, 7)
                }
                if !last { Rectangle().fill(Theme.confirmed).frame(width: 2, height: 36) }
            }
            .frame(width: 10)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 17, weight: .medium))
                Text(detail).font(.system(size: 15)).foregroundStyle(Theme.textSecondary)
            }
        }
    }
}

/// A colour drawn from the address, so the same wallet always looks the same in Recent.
private struct WalletAvatar: View {
    let address: String
    var size: CGFloat = 44

    var body: some View {
        let hue = Double(address.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0xFFFF } % 360) / 360
        Circle()
            .fill(LinearGradient(
                colors: [Color(hue: hue, saturation: 0.55, brightness: 0.85), Color(hue: (hue + 0.12).truncatingRemainder(dividingBy: 1), saturation: 0.7, brightness: 0.6)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ))
            .frame(width: size, height: size)
    }
}

#Preview {
    NavigationStack {
        WithdrawAmountView(flow: WithdrawFlow(withdrawals: FixtureWithdrawals(), vault: VaultStore(balance: TokenAmount(baseUnits: 20_000_000))))
    }
    .environment(AppEnvironment.preview)
}
