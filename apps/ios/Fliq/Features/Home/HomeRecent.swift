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
        guard kind == .deposit, !isBankDeposit, let chain = party.name.split(separator: " ").last, let token = token?.split(separator: " ").last else { return nil }
        return DepositSource(tokenId: token.lowercased(), chainId: chain.lowercased(), group: .dollars)
    }
}

/// App Design v5 Home: money still on its way, under Recent, with a turning ring and a running clock. Tapping it opens
/// the same detail as Activity. It disappears on its own when the money lands.
struct HomeInProgressCard: View {
    let line: ActivityLine
    let onSelect: (ActivityLine) -> Void

    var body: some View {
        Button { onSelect(line) } label: {
            HStack(spacing: 14) {
                ActivityBadgeView(badge: line.badge, size: 40, moving: true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(Self.headline(line))
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text(Self.detail(line, now: context.date))
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                            .monospacedDigit()
                    }
                }
                Spacer(minLength: 8)
                Icon("chevron.right", size: 16).foregroundStyle(Theme.textTertiary)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .buttonStyle(.pressable(scale: 0.98))
        .accessibilityIdentifier("home.inProgress")
    }

    /// "₦68,816 to DARA OKONKWO", "$3.41 on its way to your vault", "$10.00 to Solana wallet 4Nd1mY...uHsM".
    static func headline(_ line: ActivityLine) -> String {
        let amount = line.amount.trimmingCharacters(in: CharacterSet(charactersIn: "+-"))
        switch line.category {
        case "Deposit": return "\(amount) on its way to your vault"
        default: return "\(amount) to \(line.title)"
        }
    }

    /// "With Paycrest · 0:09". After an hour the clock stops being useful, so it says when it started.
    static func detail(_ line: ActivityLine, now: Date) -> String {
        let how: String
        switch line.category {
        case "Cash out": how = line.facts.first { $0.0 == "Paid out by" }.map { "With \($0.1)" } ?? "Paying out"
        case "Deposit": how = line.title == ActivityItem.bankPartyName ? "From your bank" : line.facts.first { $0.0 == "Network" }.map { "From \($0.1)" } ?? "Arriving"
        default: how = "Sending"
        }
        let seconds = max(0, Int(now.timeIntervalSince(line.date)))
        guard seconds < 3600 else { return "\(how) · started \(line.date.formatted(date: .omitted, time: .shortened))" }
        return "\(how) · \(seconds / 60):" + String(format: "%02d", seconds % 60)
    }
}
