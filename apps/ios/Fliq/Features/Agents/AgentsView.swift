import SwiftUI

struct AgentsView: View {
    let store: AgentStore
    @Environment(AppEnvironment.self) private var environment
    @State private var editing: Agent?
    @State private var revoking: Agent?

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                if let main = store.agents.first {
                    detail(main)
                }
                Spacer(minLength: 24)
                others
            }
            .padding(.bottom, 12)
        }
        .scrollIndicators(.hidden)
        .fliqScreen("Agents")
        .task { await store.load() }
        .sheet(item: $editing) { agent in
            AgentLimitsSheet(store: store, agent: agent)
                .presentationDetents([.height(500)])
        }
        .sheet(item: $revoking) { agent in
            AgentRevokeSheet(store: store, agent: agent)
                .presentationDetents([.height(380)])
        }
    }

    private func detail(_ agent: Agent) -> some View {
        VStack(spacing: 0) {
            VStack(spacing: 10) {
                AgentAvatar(name: agent.name, revoked: agent.status == .revoked)
                HStack(spacing: 8) {
                    Text(agent.name).font(.system(size: 16, weight: .semibold))
                    StatusDot(status: agent.status)
                }
            }
            .padding(.top, 18)

            VStack(spacing: 4) {
                Text("Spent today").font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                HeroAmount(symbol: Currency.ngn.symbol, value: agent.usedToday.formatted(), size: 54)
                Text("of \(Text(Money.local(agent.policy.dailyCap, .ngn)).foregroundStyle(Theme.textPrimary).fontWeight(.medium)) a day")
                    .font(.system(size: 14).monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
            }
            .padding(.top, 22)

            SpendBar(used: agent.usedToday, cap: agent.policy.dailyCap)
                .padding(.top, 16)

            HStack(spacing: 8) {
                tile("Per payout", Money.local(agent.policy.perPayout, .ngn))
                tile("Pays", agent.policy.currencies.map { $0.rawValue.uppercased() }.sorted().joined(separator: ", ") + " only")
            }
            .padding(.top, 14)

            if !agent.events.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(agent.events.enumerated()), id: \.element.id) { index, event in
                        EventRow(event: event, isLast: index == agent.events.count - 1)
                    }
                }
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
                .padding(.top, 8)
            }

            if agent.status != .revoked {
                HStack(spacing: 8) {
                    Button("Change limits") { editing = agent }
                        .buttonStyle(CompactButtonStyle(prominent: true))
                    Button("Revoke key") { revoking = agent }
                        .buttonStyle(CompactButtonStyle(prominent: false))
                }
                .padding(.top, 8)
            } else {
                Text("Key revoked. It can't pay from your vault.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.top, 16)
            }
        }
    }

    private var others: some View {
        VStack(spacing: 0) {
            ForEach(store.agents.dropFirst()) { agent in
                CardRow {
                    AgentAvatar(name: agent.name, size: 34, revoked: agent.status == .revoked)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(agent.name).font(.system(size: 15, weight: .medium))
                        Text("\(Money.local(agent.usedToday, .ngn)) of \(Money.local(agent.policy.dailyCap, .ngn)) today")
                            .font(.system(size: 12).monospacedDigit())
                            .foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                    StatusDot(status: agent.status)
                }
            }
            Button { environment.router.push(.agentConnect) } label: {
                CardRow {
                    Text("Connect an agent")
                    Spacer()
                    Image(systemName: "plus").font(.system(size: 15, weight: .semibold))
                }
            }
            .foregroundStyle(Theme.textPrimary)
            CardRow(isLast: true) {
                Text("Enforced by \(store.vaultAccount)")
                Spacer()
                Image(systemName: "checkmark.shield").foregroundStyle(Theme.textTertiary)
            }
        }
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
    }

    private func tile(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
            Spacer()
            Text(value).font(.system(size: 15, weight: .medium).monospacedDigit()).lineLimit(1)
        }
        .padding(.horizontal, 14)
        .frame(height: 54)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
    }
}

private struct SpendBar: View {
    let used: Int
    let cap: Int

    var body: some View {
        GeometryReader { proxy in
            Capsule().fill(Color(hex: 0x262626))
                .overlay(alignment: .leading) {
                    Capsule().fill(.white)
                        .frame(width: proxy.size.width * CGFloat(min(used, cap)) / CGFloat(max(cap, 1)))
                }
        }
        .frame(height: 4)
        .accessibilityElement()
        .accessibilityLabel("\(Money.local(used, .ngn)) of \(Money.local(cap, .ngn)) used today")
    }
}

private struct StatusDot: View {
    let status: Agent.Status

    var body: some View {
        HStack(spacing: 5) {
            Circle().frame(width: 6, height: 6)
            Text(status == .active ? "Active" : status == .pending ? "Connecting" : "Revoked")
        }
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(status == .active ? Theme.confirmed : status == .pending ? Theme.warning : Theme.textTertiary)
    }
}

private struct EventRow: View {
    let event: AgentEvent
    let isLast: Bool

    private var refused: Bool { if case .refused = event.outcome { true } else { false } }

    var body: some View {
        CardRow(isLast: isLast) {
            Text(String(event.recipient.prefix(1)))
                .font(.system(size: 14, weight: .semibold))
                .frame(width: 34, height: 34)
                .background(Theme.surfaceRaised, in: Circle())
                .opacity(refused ? 0.6 : 1)
            VStack(alignment: .leading, spacing: 2) {
                Text(event.recipient)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(refused ? Theme.textSecondary : Theme.textPrimary)
                Text(subtitle).font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(Money.local(event.amount, event.currency))
                    .font(.system(size: 15, weight: .medium).monospacedDigit())
                    .strikethrough(refused, color: Theme.textTertiary)
                    .foregroundStyle(refused ? Theme.textTertiary : Theme.textPrimary)
                Text(refused ? "Refused" : "Paid")
                    .font(.system(size: 12))
                    .foregroundStyle(refused ? Theme.warning : Theme.confirmed)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        let time = event.at.map { $0.formatted(date: .omitted, time: .shortened) }
        switch event.outcome {
        case .paid: return [time, "today"].compactMap { $0 }.first ?? "today"
        case .refused(let reason): return [time, reason].compactMap { $0 }.joined(separator: " · ")
        }
    }
}

/// The 46pt pair of buttons under the agent card.
struct CompactButtonStyle: ButtonStyle {
    let prominent: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .medium))
            .frame(maxWidth: .infinity, minHeight: 46)
            .foregroundStyle(prominent ? Theme.textPrimary : Color(hex: 0xE5E5E5))
            .fliqGlass(RoundedRectangle(cornerRadius: 14), interactive: true)
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(prominent ? Color.white.opacity(0.35) : Color(hex: 0x3A3A3A))
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.65), value: configuration.isPressed)
    }
}
