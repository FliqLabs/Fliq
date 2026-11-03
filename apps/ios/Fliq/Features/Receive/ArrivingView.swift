import SwiftUI

struct ArrivingView: View {
    let flow: ReceiveFlow
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        if let deposit = flow.deposit {
            content(deposit)
                .task { await flow.track() }
        }
    }

    private var stage: DepositStatus.Stage { flow.status?.stage ?? .waiting }

    private func content(_ deposit: DepositAddress) -> some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                SourceBadge(source: deposit.source, size: 34)
                    .frame(width: 72, height: 72)
                    .overlay(Circle().stroke(stage == .landed ? Theme.confirmed : Color(hex: 0x262626), lineWidth: 2))
                    .padding(.bottom, 8)
                HeroAmount(symbol: "+$", value: deposit.lands.decimalString)
                Text(caption)
                    .font(.system(size: 15))
                    .foregroundStyle(stage == .landed ? Theme.confirmed : Theme.textSecondary)
            }
            .padding(.top, 36)

            VStack(alignment: .leading, spacing: 0) {
                step("Seen on \(deposit.source.chain)", detail: seenDetail(deposit), reached: .seen, isLast: false)
                if !deposit.source.isDirect {
                    step("Moving to NEAR", detail: bridgeDetail(deposit), reached: .bridging, isLast: false)
                }
                step("In your vault", detail: "balance becomes $\(Money.dollars(balanceAfter(deposit)))", reached: .landed, isLast: true)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
            .padding(.top, 36)

            Spacer()

            Button("Back to vault") { environment.router.reset() }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.bottom, 12)
        }
        .fliqScreen("Arriving")
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { environment.router.reset() } label: { Image(systemName: "xmark") }
                    .accessibilityLabel("Close")
            }
        }
    }

    /// Once landed the vault already holds it; before that, show what it will hold.
    private func balanceAfter(_ deposit: DepositAddress) -> TokenAmount {
        let now = environment.vault.balance
        return stage == .landed ? now : TokenAmount(baseUnits: now.baseUnits + deposit.lands.baseUnits)
    }

    private var caption: String {
        switch stage {
        case .waiting: "Watching for your deposit"
        case .seen, .bridging: "on its way to your vault"
        case .landed: "in your vault"
        }
    }

    private func seenDetail(_ deposit: DepositAddress) -> String {
        guard let seen = flow.status?.seenAt, let received = flow.status?.received else { return "waiting" }
        return "\(seen.formatted(date: .omitted, time: .standard)) · \(received.decimalString) \(deposit.source.token)"
    }

    private func bridgeDetail(_ deposit: DepositAddress) -> String {
        guard let at = flow.status?.bridgingAt else { return "via NEAR Intents" }
        return "\(at.formatted(date: .omitted, time: .standard)) · via NEAR Intents · fee $\(deposit.fee.decimalString)"
    }

    private func step(_ title: String, detail: String, reached: DepositStatus.Stage, isLast: Bool) -> some View {
        let done = stage >= reached
        let active = !done && stage.rawValue + 1 == reached.rawValue
        return HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 6) {
                Group {
                    if done {
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .bold))
                            .frame(width: 28, height: 28)
                            .background(Theme.confirmed, in: Circle())
                    } else if active {
                        ProgressView().frame(width: 28, height: 28)
                    } else {
                        Circle()
                            .strokeBorder(Theme.textTertiary, style: StrokeStyle(lineWidth: 2, dash: [3, 4]))
                            .frame(width: 28, height: 28)
                    }
                }
                if !isLast {
                    Rectangle()
                        .fill(done ? Color.white : Color(hex: 0x333333))
                        .frame(width: 2, height: 22)
                }
            }
            .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 16, weight: .medium))
                Text(detail).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
            }
            .foregroundStyle(done || active ? Theme.textPrimary : Theme.textTertiary)
            .padding(.top, 4)
        }
    }
}
