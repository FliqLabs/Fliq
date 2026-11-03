import SwiftUI

struct SendingView: View {
    let flow: PayFlow
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        if let payout = flow.payout {
            content(payout)
                .task { await flow.track() }
                .onChange(of: payout.state) { _, state in
                    if state == .settled { environment.router.replace(with: .payPaid) }
                }
        }
    }

    private func content(_ payout: Payout) -> some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(elapsed(at: context.date))
                        .font(.system(size: 15, weight: .medium).monospacedDigit())
                        .frame(width: 72, height: 72)
                        .overlay(Circle().stroke(Color(hex: 0x262626), lineWidth: 2))
                }
                .padding(.bottom, 8)
                HeroAmount(symbol: payout.currency.symbol, value: payout.receive.formatted())
                Text("to \(payout.accountName) · ···\(payout.account.number.suffix(4))")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textSecondary)
            }
            .padding(.top, 36)

            VStack(alignment: .leading, spacing: 0) {
                ForEach(Step.allCases, id: \.self) { step in
                    StepRow(step: step, progress: step.progress(for: payout.state), provider: payout.provider)
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
            .padding(.top, 36)

            if let outcome = outcome(for: payout.state) {
                Text(outcome)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.warning)
                    .multilineTextAlignment(.center)
                    .padding(.top, 16)
            }

            Spacer()
        }
        .fliqScreen("Sending")
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { environment.router.reset() } label: { Image(systemName: "xmark") }
                    .accessibilityLabel("Close")
            }
        }
    }

    private func elapsed(at date: Date) -> String {
        let seconds = Int(date.timeIntervalSince(flow.sentAt ?? date))
        return Duration.seconds(seconds).formatted(.time(pattern: .minuteSecond))
    }

    private func outcome(for state: PayoutState) -> String? {
        switch state {
        case .refunded: "The provider didn't pay out. Your money is back in your vault."
        case .refused: "The vault refused this payout. Nothing moved."
        case .notReceived: "The bank hasn't confirmed this yet. We're chasing it."
        case .awaitingDeposit, .depositSeen, .payingOut, .settled: nil
        }
    }
}

private enum Step: CaseIterable {
    case vault, provider, bank

    enum Progress { case done, active, waiting }

    func progress(for state: PayoutState) -> Progress {
        let reached: Int = switch state {
        case .awaitingDeposit: 0
        case .depositSeen: 1
        case .payingOut: 2
        case .settled: 3
        case .refused, .refunded, .notReceived: 1
        }
        let index = Self.allCases.firstIndex(of: self) ?? 0
        if index < reached { return .done }
        return index == reached ? .active : .waiting
    }
}

private struct StepRow: View {
    let step: Step
    let progress: Step.Progress
    let provider: ProviderID

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 6) {
                indicator
                if step != .bank {
                    Rectangle()
                        .fill(progress == .done ? Color.white : Color(hex: 0x333333))
                        .frame(width: 2, height: 22)
                }
            }
            .frame(width: 28)
            Text(title)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(progress == .waiting ? Theme.textTertiary : Theme.textPrimary)
                .padding(.top, 4)
        }
    }

    @ViewBuilder
    private var indicator: some View {
        switch progress {
        case .done:
            Image(systemName: "checkmark")
                .font(.system(size: 12, weight: .bold))
                .frame(width: 28, height: 28)
                .background(Theme.confirmed, in: Circle())
        case .active:
            ProgressView()
                .frame(width: 28, height: 28)
        case .waiting:
            Circle()
                .strokeBorder(Theme.textTertiary, style: StrokeStyle(lineWidth: 2, dash: [3, 4]))
                .frame(width: 28, height: 28)
        }
    }

    private var title: String {
        switch step {
        case .vault: "Left your vault"
        case .provider: "With \(provider.displayName)"
        case .bank: "Paid"
        }
    }
}
