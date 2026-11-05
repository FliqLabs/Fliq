import SwiftUI

/// Shown when the provider could not pay out and the vault took the money back.
struct RefundedView: View {
    let payout: Payout
    var quote: Quote?
    var onTryAgain: (() -> Void)?
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                Image(systemName: "arrow.counterclockwise")
                    .font(.system(size: 28, weight: .medium))
                    .frame(width: 72, height: 72)
                    .background(Theme.surface, in: Circle())
                    .padding(.bottom, 8)
                HeroAmount(symbol: "$", value: payout.amount.decimalString)
                Text("is back in your vault.\n\(payout.provider.displayName) could not reach \(payout.institutionName). Nothing reached \(payout.accountName).")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
            }
            .padding(.top, 36)

            timeline
                .padding(.top, 30)

            if let next = nextBest {
                HStack(spacing: 14) {
                    Image(systemName: "arrow.triangle.branch")
                        .frame(width: 40, height: 40)
                        .background(Theme.surfaceRaised, in: Circle())
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Next best: \(next.provider.displayName)").font(.system(size: 15, weight: .medium))
                        Text("About \(Money.local(next.receive, payout.currency)) at today's rate")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                }
                .padding(14)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
                .padding(.top, 10)
            }

            Spacer()

            if let onTryAgain {
                Button("Get a new quote", action: onTryAgain)
                    .buttonStyle(PrimaryButtonStyle(filled: true))
            }
            Button("Keep it in the vault") { environment.router.reset() }
                .font(.system(size: 15))
                .foregroundStyle(Theme.textSecondary)
                .frame(height: 40)
                .padding(.top, 14)
                .padding(.bottom, 8)
        }
        .fliqScreen("Refunded")
        .navigationBarBackButtonHidden(onTryAgain != nil)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { environment.router.reset() } label: { Image(systemName: "xmark") }
                    .accessibilityLabel("Close")
            }
        }
    }

    private var timeline: some View {
        VStack(alignment: .leading, spacing: 18) {
            ForEach(Array(payout.history.enumerated()), id: \.offset) { _, change in
                if let title = title(for: change.state) {
                    HStack(spacing: 14) {
                        Image(systemName: change.state == .payingOut ? "xmark" : "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(change.state == .payingOut ? .black : .white)
                            .frame(width: 26, height: 26)
                            .background(change.state == .payingOut ? Color.white : Theme.confirmed, in: Circle())
                        VStack(alignment: .leading, spacing: 3) {
                            Text(title).font(.system(size: 16, weight: .medium))
                            Text(change.at.formatted(date: .omitted, time: .standard))
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
    }

    private func title(for state: PayoutState) -> String? {
        switch state {
        case .depositSeen: "Left your vault"
        case .payingOut: "\(payout.provider.displayName) could not pay out"
        case .refunded: "Refunded to your vault · $\(payout.amount.decimalString)"
        default: nil
        }
    }

    private var nextBest: (provider: ProviderID, receive: Int)? {
        guard let quote else { return nil }
        let next = quote.routes
            .filter { $0.status == .live && $0.provider != payout.provider }
            .compactMap { route in route.rate.map { (route.provider, $0) } }
            .max { $0.1 < $1.1 }
        return next.map { ($0.0, Money.estimate(quote.amount, at: $0.1)) }
    }
}
