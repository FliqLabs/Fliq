import SwiftUI

struct QuoteView: View {
    let flow: PayFlow
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        if let quote = flow.quote {
            content(quote)
        }
    }

    private func content(_ quote: Quote) -> some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                Text(flow.verified.map { "\($0.accountName) receives" } ?? "They receive")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                HeroAmount(symbol: quote.currency.symbol, value: quote.receive.formatted())
            }
            .padding(.top, 36)

            DetailCard {
                DetailRow("You send", "$" + quote.amount.decimalString)
                DetailRow("Rate after fees", "$1 = " + Money.rate(quote.rate, quote.currency))
                DetailRow("Fees", Money.fee(quote.fees.total, quote.currency))
                DetailRow(label: "Route", isLast: true) {
                    HStack(spacing: 8) {
                        Text("Best of \(quote.bestOf)")
                        if let advantage = Money.routeAdvantage(quote) {
                            Text("+" + Money.local(advantage, quote.currency))
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.confirmed)
                        }
                    }
                }
            }
            .padding(.top, 32)

            HStack(spacing: 14) {
                Image(systemName: "checkmark.seal")
                    .font(.system(size: 20))
                    .frame(width: 40, height: 40)
                    .background(Theme.surfaceRaised, in: Circle())
                Text("Paid out by \(quote.provider.displayName)")
                    .font(.system(size: 15, weight: .medium))
                Spacer()
            }
            .padding(14)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
            .padding(.top, 10)

            Spacer()

            TimelineView(.periodic(from: .now, by: 1)) { context in
                countdown(quote, now: context.date)
            }
        }
        .fliqScreen("Confirm")
    }

    private func countdown(_ quote: Quote, now: Date) -> some View {
        let left = flow.secondsLeft(at: now)
        let expired = left == 0

        return VStack(spacing: 14) {
            VStack(spacing: 10) {
                HStack {
                    Text(expired ? "Rate expired" : "Rate held for")
                    Spacer()
                    Text(Duration.seconds(left).formatted(.time(pattern: .minuteSecond)))
                        .foregroundStyle(Theme.textPrimary)
                        .fontWeight(.medium)
                        .monospacedDigit()
                }
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
                ProgressView(value: Double(left), total: Double(quote.expiresIn))
                    .tint(.white)
            }

            if let message = flow.errorMessage {
                Text(message)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.warning)
                    .multilineTextAlignment(.center)
            }

            if expired {
                Button("Get a new quote") { Task { _ = await flow.fetchQuote() } }
                    .buttonStyle(PrimaryButtonStyle())
            } else {
                Button { confirm() } label: {
                    Label("Confirm with Face ID", systemImage: "faceid")
                }
                .buttonStyle(PrimaryButtonStyle(filled: true))
                .disabled(flow.isSending)
            }
        }
        .padding(.bottom, 12)
    }

    private func confirm() {
        Task {
            guard let quote = flow.quote else { return }
            let reason = "Send \(Money.local(quote.receive, quote.currency)) to \(flow.verified?.accountName ?? "this account")"
            guard await environment.biometrics.approve(reason) else { return }
            if await flow.send() { environment.router.replace(with: .paySending) }
        }
    }
}
