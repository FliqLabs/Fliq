import SwiftUI

struct QuoteView: View {
    let flow: PayFlow
    @Environment(AppEnvironment.self) private var environment
    @State private var showingRoutes = false

    var body: some View {
        if let quote = flow.quote {
            content(quote)
        }
    }

    private func content(_ quote: Quote) -> some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    if let verified = flow.verified {
                        InstitutionLogo(logoKey: verified.logoKey, name: verified.institution, size: 20)
                    }
                    Text(flow.verified.map { "\($0.accountName) receives" } ?? "They receive")
                        .lineLimit(1)
                }
                .font(.system(size: 15))
                .foregroundStyle(Theme.textSecondary)
                HeroAmount(symbol: quote.currency.symbol, value: quote.receive.formatted())
                switch quote.instant {
                case true?:
                    Label("Instant · usually under a minute", systemImage: "bolt.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(Theme.confirmed)
                case false?:
                    Text("Larger amount · can take up to an hour")
                        .font(.system(size: 16))
                        .foregroundStyle(Theme.warning)
                case nil:
                    if let eta = quote.etaSeconds {
                        Text("in about \(Self.duration(eta))")
                            .font(.system(size: 16))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 36)

            DetailCard {
                DetailRow("You send", "$" + quote.amount.decimalString)
                DetailRow("Rate after fees", "$1 = " + Money.rate(quote.rate, quote.currency))
                DetailRow("Fees", Money.fee(quote.fees.total, quote.currency))
                Button { showingRoutes = true } label: {
                    DetailRow(label: "Route", isLast: true) {
                        HStack(spacing: 8) {
                            Text("Best of \(quote.bestOf)")
                            if let advantage = quote.savingVsNext.flatMap({ $0 > 0 ? $0 : nil }) ?? Money.routeAdvantage(quote) {
                                Text("+" + Money.local(advantage, quote.currency))
                                    .font(.system(size: 13))
                                    .foregroundStyle(Theme.confirmed)
                            }
                            Icon("chevron.right", size: 16)
                                .foregroundStyle(Theme.textTertiary)
                        }
                    }
                }
                .foregroundStyle(Theme.textPrimary)
            }
            .padding(.top, 32)

            HStack(spacing: 14) {
                ProviderMark(provider: quote.provider, size: 44)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Paid out by \(quote.provider.displayName)")
                        .font(.system(size: 16, weight: .medium))
                    if let detail = providerDetail(quote) {
                        Text(detail)
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
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
        .sheet(isPresented: $showingRoutes) {
            RoutesSheet(quote: quote)
                .presentationDetents([.fraction(0.68)])
        }
    }

    /// "96% on time · alert shows": the chosen route's record, from the quote.
    private func providerDetail(_ quote: Quote) -> String? {
        let route = quote.routes.first { $0.routed == true } ?? quote.routes.first { $0.provider == quote.provider }
        guard let onTime = route?.onTimePercent else { return nil }
        return "\(onTime)% on time · alert shows"
    }

    static func duration(_ seconds: Int) -> String {
        seconds < 90 ? "\(seconds) seconds" : "\(Int((Double(seconds) / 60).rounded())) minutes"
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
                    IconLabel("Confirm with Face ID", icon: "faceid")
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
