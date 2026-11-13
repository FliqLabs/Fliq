import SwiftUI

/// App Design v5 Home: the two newest things that moved money, with See all opening Activity.
struct HomeRecentCard: View {
    let lines: [ActivityLine]
    let onSeeAll: () -> Void
    let onSelect: (ActivityLine) -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("RECENT")
                    .font(.system(size: 13, weight: .medium))
                    .tracking(1.2)
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                Button("See all", action: onSeeAll)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textSecondary)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 2)
            ForEach(lines) { line in
                Button { onSelect(line) } label: {
                    ActivityCell(line: line, boxed: false)
                }
                .buttonStyle(.pressable(scale: 0.98))
            }
        }
        .padding(.vertical, 14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
    }
}

extension ActivityItem {
    /// The amount as the row leads with it: Naira for a payout, dollars in or out for everything else.
    var headline: String {
        let dollars = usd.map { "$" + $0 } ?? ""
        switch kind {
        case .deposit, .transferIn: return "+" + dollars
        case .transferOut: return "-" + dollars
        default:
            guard let local, let value = Int(local.amount) else { return dollars }
            guard let currency = Currency(rawValue: local.currency.lowercased()) else { return "\(local.currency) \(local.amount)" }
            return Money.local(value, currency)
        }
    }

    /// "Received from Solana" with "200 USDC" becomes USDC on Solana, for the coin-and-network badge.
    var depositSource: DepositSource? {
        guard kind == .deposit, let chain = party.name.split(separator: " ").last, let token = token?.split(separator: " ").last else { return nil }
        return DepositSource(tokenId: token.lowercased(), chainId: chain.lowercased(), group: .dollars)
    }
}
