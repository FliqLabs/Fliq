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

/// A cash-out from this iPhone that has not settled yet: the provider's mark in a turning ring and the time so far.
struct HomeMovingCard: View {
    let entry: ActivityStore.Entry
    let onOpen: () -> Void
    @State private var angle = 0.0

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 14) {
                ProviderMark(provider: entry.payout.provider, size: 40)
                    .padding(5)
                    .overlay {
                        Circle()
                            .strokeBorder(Color.white, style: StrokeStyle(lineWidth: 2.5, dash: [10, 8]))
                            .rotationEffect(.degrees(angle))
                    }
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(Money.local(entry.payout.receive, entry.payout.currency)) to \(entry.payout.accountName)")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text("With \(entry.payout.provider.displayName) · \(elapsed(at: context.date))")
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.textSecondary)
                            .monospacedDigit()
                    }
                }
                Spacer(minLength: 8)
                Icon("chevron.right", size: 18).foregroundStyle(Theme.textSecondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 26))
        }
        .buttonStyle(.plain)
        .onAppear { withAnimation(.linear(duration: 2).repeatForever(autoreverses: false)) { angle = 360 } }
    }

    private func elapsed(at now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(entry.startedAt)))
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}

extension ActivityStore {
    /// The newest cash-out from this iPhone that is still on its way.
    var moving: Entry? {
        entries.first { ![.settled, .refunded, .refused].contains($0.payout.state.stage) }
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
