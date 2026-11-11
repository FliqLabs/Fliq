import SwiftUI

/// App Design v5 Home: the two newest things that moved money, with See all opening Activity.
struct HomeRecentCard: View {
    let rows: [ActivityStore.Row]
    let onSeeAll: () -> Void
    let onOpen: (String) -> Void

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
            .padding(.bottom, 6)
            ForEach(rows) { row in
                if let id = row.payoutId {
                    Button { onOpen(id) } label: { RecentRow(row: row) }.buttonStyle(.plain)
                } else {
                    RecentRow(row: row)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
    }
}

private struct RecentRow: View {
    let row: ActivityStore.Row

    var body: some View {
        HStack(spacing: 14) {
            badge.frame(width: 44, height: 44)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 17, weight: .medium)).lineLimit(1)
                Text(subtitle).font(.system(size: 14)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 3) {
                Text(amount).font(.system(size: 17, weight: .medium)).monospacedDigit()
                Text(detail).font(.system(size: 14)).foregroundStyle(Theme.textTertiary).monospacedDigit()
            }
        }
        .foregroundStyle(Theme.textPrimary)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var badge: some View {
        switch row {
        case .local(let entry):
            BankBadge(name: entry.payout.accountName, bank: entry.payout.account.bank)
        case .history(let item):
            switch item.kind {
            case .deposit:
                if let source = item.depositSource { SourceBadge(source: source, size: 40, ring: Theme.surface) } else { arrowDown }
            case .transferIn: arrowDown
            case .transferOut: PersonAvatar(name: item.party.name, size: 40)
            default: BankBadge(name: item.party.name, bank: item.party.institution)
            }
        }
    }

    private var arrowDown: some View {
        Icon("arrow.down", size: 18)
            .foregroundStyle(Theme.confirmed)
            .frame(width: 40, height: 40)
            .background(Theme.surfaceRaised, in: Circle())
    }

    private var title: String {
        switch row {
        case .local(let entry): entry.payout.accountName
        case .history(let item): item.party.name
        }
    }

    private var subtitle: String {
        var parts = [row.date.formatted(date: .omitted, time: .shortened)]
        switch row {
        case .local(let entry):
            parts.append(entry.payout.provider.displayName)
            if case .agent(let name) = entry.source { parts.append("by \(name)") }
        case .history(let item):
            switch item.kind {
            case .payout, .refused:
                if let provider = item.provider { parts.append(ProviderID(rawValue: provider)?.displayName ?? provider.capitalized) }
                if let agent = item.agent { parts.append("by \(agent.name)") }
            case .deposit:
                if let seconds = item.seconds { parts.append("\(seconds)s") }
            case .transferIn, .transferOut:
                if let account = item.party.nearAccount { parts.append(account) }
            case .unknown: break
            }
        }
        return parts.joined(separator: " · ")
    }

    private var amount: String {
        switch row {
        case .local(let entry): Money.local(entry.payout.receive, entry.payout.currency)
        case .history(let item): item.headline
        }
    }

    private var detail: String {
        switch row {
        case .local(let entry): "$" + entry.payout.amount.decimalString
        case .history(let item):
            switch item.kind {
            case .deposit: item.token ?? ""
            case .refused: "Refused"
            case .payout: item.usd.map { "$" + $0 } ?? ""
            default: ""
            }
        }
    }
}

/// The account holder's circle with their bank's logo tucked at the bottom left, as on the v5 Recent card.
private struct BankBadge: View {
    let name: String
    let bank: String?

    var body: some View {
        Circle()
            .fill(Color.clear)
            .frame(width: 40, height: 40)
            .overlay(alignment: .bottomLeading) {
                InstitutionLogo(logoKey: Institution.supported.first { $0.code == bank }?.logoKey, name: name, size: 22)
                    .padding(2)
                    .background(Theme.surface, in: Circle())
                    .offset(x: -2, y: 2)
            }
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

extension ActivityStore.Row {
    /// The payout a row opens, when it is one.
    var payoutId: String? {
        switch self {
        case .local(let entry): entry.id
        case .history(let item): item.kind == .payout ? item.refId : nil
        }
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
