import SwiftUI

struct ActivityView: View {
    let store: ActivityStore
    let onReceive: () -> Void
    @State private var filter = Filter.all

    enum Filter: String, CaseIterable {
        case all = "All", mine = "Mine", agents = "Agents"
    }

    var body: some View {
        VStack(spacing: 0) {
            Text("Activity")
                .font(.system(size: 26, weight: .bold))
                .tracking(-0.52)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 20)
            HStack(spacing: 8) {
                ForEach(Filter.allCases, id: \.self) { option in
                    Button(option.rawValue) { filter = option }
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(filter == option ? .black : Theme.textSecondary)
                        .padding(.horizontal, 16)
                        .frame(height: 34)
                        .background(filter == option ? Color.white : Theme.field, in: Capsule())
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 14)

            if shown.isEmpty {
                empty
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        ForEach(days, id: \.title) { day in
                            Text(day.title)
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textSecondary)
                                .padding(.top, 14)
                                .padding(.horizontal, 2)
                            ForEach(day.entries) { entry in
                                NavigationLink(value: AppRoute.receipt(payoutId: entry.id)) {
                                    ActivityRow(entry: entry)
                                }
                            }
                        }
                    }
                    .padding(.top, 8)
                }
                .scrollIndicators(.hidden)
            }
        }
    }

    private var empty: some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 24))
                .foregroundStyle(Theme.textTertiary)
                .frame(width: 64, height: 64)
                .background(Theme.surface, in: Circle())
            Text("Nothing yet").font(.system(size: 17, weight: .semibold))
            Text("Your first receipt lands here.")
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
            Spacer()
            Button("Receive", action: onReceive)
                .buttonStyle(PrimaryButtonStyle())
                .padding(.bottom, 12)
        }
    }

    private var shown: [ActivityStore.Entry] {
        store.entries.filter { entry in
            switch (filter, entry.source) {
            case (.all, _), (.mine, .mine), (.agents, .agent): true
            default: false
            }
        }
    }

    private var days: [(title: String, entries: [ActivityStore.Entry])] {
        let calendar = Calendar.current
        let grouped = Dictionary(grouping: shown) { calendar.startOfDay(for: $0.startedAt) }
        return grouped.keys.sorted(by: >).map { day in
            let title = calendar.isDateInToday(day) ? "Today"
                : calendar.isDateInYesterday(day) ? "Yesterday"
                : day.formatted(date: .abbreviated, time: .omitted)
            return (title, grouped[day] ?? [])
        }
    }
}

private struct ActivityRow: View {
    let entry: ActivityStore.Entry

    private var payout: Payout { entry.payout }

    var body: some View {
        HStack(spacing: 14) {
            Text(String(payout.accountName.prefix(1)))
                .font(.system(size: 16, weight: .semibold))
                .frame(width: 38, height: 38)
                .background(Theme.surfaceRaised, in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 15, weight: .medium)).lineLimit(1)
                Text(subtitle).font(.system(size: 13)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text(amount)
                    .font(.system(size: 15, weight: .medium).monospacedDigit())
                    .strikethrough(payout.state.stage == .refused, color: Theme.textTertiary)
                    .foregroundStyle(payout.state.stage == .refused ? Theme.textTertiary : Theme.textPrimary)
                HStack(spacing: 0) {
                    if payout.state != .refunded {
                        Text("$\(payout.amount.decimalString) · ").foregroundStyle(Theme.textTertiary)
                    }
                    status
                }
                .font(.system(size: 12))
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 66)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .foregroundStyle(Theme.textPrimary)
        .accessibilityElement(children: .combine)
    }

    private var title: String {
        switch entry.source {
        case .mine: payout.accountName
        case .agent(let name): "\(name) · \(payout.accountName)"
        }
    }

    private var subtitle: String {
        var parts = [entry.startedAt.formatted(date: .omitted, time: .shortened)]
        switch payout.state.stage {
        case .refunded: parts.append("\(payout.provider.displayName) failed")
        case .refused: parts.append("over your cap")
        default:
            parts.append(payout.provider.displayName)
            if let seconds = payout.seconds { parts.append("\(seconds)s") }
        }
        return parts.joined(separator: " · ")
    }

    private var amount: String {
        payout.state == .refunded ? "$" + payout.amount.decimalString : Money.local(payout.receive, payout.currency)
    }

    @ViewBuilder
    private var status: some View {
        switch payout.state.stage {
        case .settled: Text("Paid").foregroundStyle(Theme.confirmed)
        case .refunded: Text("Refunded").foregroundStyle(Theme.textSecondary)
        case .refused: Text("Refused").foregroundStyle(Theme.warning)
        case .notReceived: Text("Checking").foregroundStyle(Theme.warning)
        default: Text("Sending").foregroundStyle(Theme.textSecondary)
        }
    }
}
