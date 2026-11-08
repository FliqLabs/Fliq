import SwiftUI

/// The live USDC to naira rate next to the official and street references.
struct LiveRatesSheet: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss
    @State private var rate: Rate?

    var body: some View {
        VStack(spacing: 12) {
            SheetHeader(title: "Live rates") { dismiss() }
            if let rate {
                VStack(spacing: 4) {
                    Text("$1 after fees").font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                    HeroAmount(symbol: rate.currency.symbol, value: rate.rate.formatted(.number.precision(.fractionLength(2))), size: 48)
                    Text("Best of \(rate.providersQuoting) quoting · \(rate.provider.displayName)")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                }
                .padding(.top, 8)

                VStack(spacing: 0) {
                    DetailRow("Before fees", Money.rate(rate.rateBeforeFees, rate.currency), isLast: rate.official == nil && rate.p2p == nil && rate.change24h == nil)
                    if let official = rate.official {
                        DetailRow("Official close", Money.rate(official.rate, rate.currency), isLast: rate.p2p == nil && rate.change24h == nil)
                    }
                    if let p2p = rate.p2p {
                        DetailRow("P2P median", Money.rate(p2p.rate, rate.currency), isLast: rate.change24h == nil)
                    }
                    if let change = rate.change24h {
                        DetailRow("Change today", (change * 100).formatted(.number.precision(.fractionLength(2)).sign(strategy: .always())) + "%", isLast: true)
                    }
                }
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
                .padding(.top, 8)
            } else {
                ProgressView().padding(.top, 40)
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .foregroundStyle(Theme.textPrimary)
        .task { rate = try? await environment.api.rate(.usdc, .ngn) }
    }
}
