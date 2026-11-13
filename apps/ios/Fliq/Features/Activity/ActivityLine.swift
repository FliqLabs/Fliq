import SwiftUI

/// What one Activity row says, worked out once from either a live payout on this iPhone or a row from
/// `GET /activity`, so the Activity list, Home's Recent card and the detail sheet always agree.
struct ActivityLine: Identifiable {
    enum Badge {
        case bank(name: String, logoKey: String?)
        case agent(AgentApp)
        case source(DepositSource)
        case incoming
        case person(name: String, photo: URL?, incoming: Bool)
    }

    enum Outcome { case done, moving, refunded, refused, failed }

    struct Step {
        let title: String
        let detail: String
        let done: Bool
    }

    let id: String
    let date: Date
    let badge: Badge
    let title: String
    let subtitle: String
    let amount: String
    let dollars: String?
    let statusText: String
    let statusColor: Color
    let outcome: Outcome
    let category: String
    let facts: [(String, String)]
    let steps: [Step]
    let payoutId: String?

    var isAgent: Bool { if case .agent = badge { true } else { false } }
}

extension ActivityLine {
    init(_ row: ActivityStore.Row, institutions: [String: Institution]) {
        switch row {
        case .local(let entry): self.init(entry: entry, institutions: institutions)
        case .history(let item): self.init(item: item, institutions: institutions)
        }
    }

    private init(entry: ActivityStore.Entry, institutions: [String: Institution]) {
        let payout = entry.payout
        let bank = institutions[payout.account.bank] ?? Institution.supported.first { $0.code == payout.account.bank }
        let provider = payout.provider.displayName
        var agentName: String?
        if case .agent(let name) = entry.source { agentName = name }
        let outcome = Self.outcome(of: payout.state.stage)
        id = "local-" + payout.payoutId
        date = entry.startedAt
        badge = agentName.map { .agent(AgentApp.named($0)) } ?? .bank(name: payout.accountName, logoKey: bank?.logoKey)
        title = agentName.map { "\($0) · \(payout.accountName)" } ?? payout.accountName
        subtitle = Self.join(date, provider, bank?.name, payout.seconds.map { "\($0)s" })
        amount = outcome == .refunded ? "$" + payout.amount.decimalString : Money.local(payout.receive, payout.currency)
        dollars = outcome == .refunded ? nil : "$" + payout.amount.decimalString
        let status = Self.status(outcome)
        statusText = status.0
        statusColor = status.1
        self.outcome = outcome
        category = "Cash out"
        facts = [
            ("Status", statusText),
            ("They receive", Money.local(payout.receive, payout.currency)),
            ("From your vault", "$" + payout.amount.decimalString),
            ("Rate", "$1 = \(payout.currency.symbol)\(payout.rate.formatted(.number.precision(.fractionLength(2))))"),
            ("Paid out by", provider),
            ("Bank", bank?.name ?? payout.account.bank),
            ("Account", "•••• " + String(payout.account.number.suffix(4))),
            ("Reference", payout.payoutId),
        ] + (agentName.map { [("Agent", $0)] } ?? [])
        steps = Self.payoutSteps(outcome, at: date, seconds: payout.seconds, bank: bank?.name, provider: provider)
        payoutId = payout.payoutId
    }

    private init(item: ActivityItem, institutions: [String: Institution]) {
        let bank = item.party.institution.flatMap { code in institutions[code] ?? Institution.supported.first { $0.code == code } }
        let provider = item.provider.map { ProviderID(rawValue: $0)?.displayName ?? $0.capitalized }
        let outcome = Self.outcome(of: item)
        id = item.id
        date = item.at
        title = item.agent.map { "\($0.name) · \(item.party.name)" } ?? item.party.name
        amount = item.kind == .payout && outcome == .refunded ? item.usd.map { "$" + $0 } ?? item.headline : item.headline
        self.outcome = outcome
        let status = Self.status(outcome, kind: item.kind)
        statusText = status.0
        statusColor = status.1
        payoutId = item.kind == .payout ? item.refId : nil

        switch item.kind {
        case .deposit:
            badge = item.depositSource.map(Badge.source) ?? .incoming
            subtitle = Self.join(date, item.seconds.map { "\($0)s" })
            dollars = item.token
            category = "Deposit"
            let chain = item.depositSource?.chainId.capitalized ?? "another chain"
            steps = [
                Step(title: "Sent on \(chain)", detail: Self.time(date), done: true),
                Step(title: "Delivered to your vault", detail: Self.time(date.addingTimeInterval(Double(item.seconds ?? 0))), done: outcome == .done),
            ]
            facts = [("Status", statusText), ("You sent", item.token ?? ""), ("Delivered", item.usd.map { "$" + $0 } ?? ""), ("Network", chain), ("Reference", item.refId)]
        case .transferIn, .transferOut:
            let incoming = item.kind == .transferIn
            badge = .person(name: item.party.name, photo: item.party.photoUrl.flatMap(URL.init(string:)), incoming: incoming)
            subtitle = Self.join(date, item.party.nearAccount)
            dollars = nil
            category = incoming ? "Received" : "Sent"
            steps = [Step(title: incoming ? "Received from \(item.party.name)" : "Sent to \(item.party.name)", detail: Self.time(date), done: true)]
            facts = [("Status", statusText), ("Amount", item.usd.map { "$" + $0 } ?? ""), (incoming ? "From" : "To", item.party.nearAccount ?? item.party.name), ("Reference", item.refId)]
        case .refused:
            badge = item.agent.map { .agent(AgentApp.named($0.name)) } ?? .bank(name: item.party.name, logoKey: bank?.logoKey)
            let reason = Self.reason(item.reason)
            subtitle = Self.join(date, reason)
            dollars = nil
            category = "Refused"
            steps = [
                Step(title: "\(item.agent?.name ?? "An agent") asked to pay \(item.party.name)", detail: Self.time(date), done: true),
                Step(title: "Refused: \(reason)", detail: "Nothing left your vault", done: false),
            ]
            facts = [("Status", "Refused"), ("Asked for", item.headline), ("Why", reason), ("Agent", item.agent?.name ?? ""), ("Reference", item.refId)]
        case .payout, .unknown:
            badge = item.agent.map { .agent(AgentApp.named($0.name)) } ?? .bank(name: item.party.name, logoKey: bank?.logoKey)
            subtitle = outcome == .refunded
                ? Self.join(date, provider.map { "\($0) failed" })
                : Self.join(date, provider, bank?.name, item.seconds.map { "\($0)s" })
            dollars = outcome == .refunded ? nil : item.usd.map { "$" + $0 }
            category = "Cash out"
            steps = Self.payoutSteps(outcome, at: date, seconds: item.seconds, bank: bank?.name, provider: provider ?? "the provider")
            facts = [
                ("Status", statusText),
                ("They receive", item.headline),
                ("From your vault", item.usd.map { "$" + $0 } ?? ""),
                ("Paid out by", provider ?? ""),
                ("Bank", bank?.name ?? item.party.institution ?? ""),
                ("Account", item.party.accountLast4.map { "•••• " + $0 } ?? ""),
                ("Agent", item.agent?.name ?? ""),
                ("Reference", item.refId),
            ]
        }
    }

    private static func outcome(of stage: PayoutState) -> Outcome {
        switch stage {
        case .settled: .done
        case .refunded: .refunded
        case .refused: .refused
        case .failed, .expired: .failed
        default: .moving
        }
    }

    private static func outcome(of item: ActivityItem) -> Outcome {
        switch item.status {
        case "paid", "received", "sent": .done
        case "refunded": .refunded
        case "refused": .refused
        case "failed", "expired": .failed
        default: .moving
        }
    }

    private static func status(_ outcome: Outcome, kind: ActivityItem.Kind = .payout) -> (String, Color) {
        switch outcome {
        case .done: (kind == .deposit || kind == .transferIn ? "Received" : kind == .transferOut ? "Sent" : "Paid", Theme.confirmed)
        case .moving: (kind == .deposit ? "Arriving" : "Sending", Theme.textSecondary)
        case .refunded: ("Refunded", Theme.textSecondary)
        case .refused: ("Refused", Theme.warning)
        case .failed: ("Failed", Theme.danger)
        }
    }

    private static func payoutSteps(_ outcome: Outcome, at date: Date, seconds: Int?, bank: String?, provider: String) -> [Step] {
        let left = Step(title: "Left your vault", detail: time(date), done: true)
        let landed = time(date.addingTimeInterval(Double(seconds ?? 0)))
        switch outcome {
        case .done: return [left, Step(title: "Paid into \(bank ?? "the account") by \(provider)", detail: landed, done: true)]
        case .refunded: return [left, Step(title: "\(provider) couldn't pay", detail: landed, done: false), Step(title: "Back in your vault", detail: "Refunded in full", done: true)]
        case .failed: return [left, Step(title: "\(provider) couldn't pay", detail: landed, done: false)]
        case .refused: return [Step(title: "Refused", detail: "Nothing left your vault", done: false)]
        case .moving: return [left, Step(title: "Paying out with \(provider)", detail: "Usually under a minute", done: false)]
        }
    }

    private static func reason(_ code: String?) -> String {
        switch code {
        case "over_daily_cap": "over daily cap"
        case "over_per_payout_cap": "over per-payout cap"
        case "corridor_not_allowed": "country not allowed"
        case "not_saved_account": "not a saved account"
        case "provider_failed": "provider failed"
        case "expired": "expired"
        default: "over your limits"
        }
    }

    static func time(_ date: Date) -> String {
        date.formatted(.dateTime.month(.abbreviated).day().hour().minute())
    }

    private static func join(_ date: Date, _ parts: String?...) -> String {
        ([date.formatted(date: .omitted, time: .shortened)] + parts.compactMap { $0 }.filter { !$0.isEmpty }).joined(separator: " · ")
    }
}

extension AgentApp {
    static func named(_ name: String) -> AgentApp {
        let lower = name.lowercased()
        if lower.contains("claude") { return .claude }
        if lower.contains("chatgpt") || lower.contains("codex") || lower.contains("openai") { return .openai }
        if lower.contains("cursor") { return .cursor }
        return .other
    }
}

/// The leading mark of a row: the bank's logo, the agent's logo, the person's photo, or the coin with its network.
/// While the money is still on its way, a ring turns around it.
struct ActivityBadgeView: View {
    let badge: ActivityLine.Badge
    var size: CGFloat = 44
    var moving = false

    var body: some View {
        mark
            .padding(moving ? 4 : 0)
            .overlay { if moving { SpinningRing() } }
    }

    @ViewBuilder
    private var mark: some View {
        switch badge {
        case .bank(let name, let logoKey):
            InstitutionLogo(logoKey: logoKey, name: name, size: size * 0.82)
                .frame(width: size, height: size)
        case .agent(let app):
            AgentLogo(app: app, size: size)
        case .source(let source):
            SourceBadge(source: source, size: size * 0.9, ring: Theme.surface)
                .frame(width: size, height: size)
        case .incoming:
            Icon("arrow.down", size: size * 0.4)
                .foregroundStyle(Theme.confirmed)
                .frame(width: size, height: size)
                .background(Theme.surfaceRaised, in: Circle())
        case .person(let name, let photo, let incoming):
            PersonAvatar(name: name, photoURL: photo, size: size)
                .overlay(alignment: .bottomTrailing) {
                    Icon(incoming ? "arrow.down" : "arrow.up", size: size * 0.22)
                        .foregroundStyle(incoming ? Theme.confirmed : Theme.textPrimary)
                        .frame(width: size * 0.4, height: size * 0.4)
                        .background(Theme.surfaceRaised, in: Circle())
                        .overlay(Circle().strokeBorder(Theme.surface, lineWidth: 2))
                        .offset(x: 3, y: 3)
                }
        }
    }
}

/// One row as App Design v5 draws it: mark, two lines on the left, amount over "$50.00 · Paid" on the right.
struct ActivityCell: View {
    let line: ActivityLine
    var boxed = true

    var body: some View {
        HStack(spacing: 14) {
            ActivityBadgeView(badge: line.badge, moving: line.outcome == .moving)
            VStack(alignment: .leading, spacing: 4) {
                Text(line.title).font(.system(size: 16, weight: .medium)).lineLimit(2)
                Text(line.subtitle).font(.system(size: 13)).foregroundStyle(Theme.textSecondary).lineLimit(2)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                Text(line.amount)
                    .font(.system(size: 16, weight: .medium))
                    .monospacedDigit()
                    .strikethrough(line.outcome == .refused, color: Theme.textTertiary)
                    .foregroundStyle(line.outcome == .refused ? Theme.textTertiary : Theme.textPrimary)
                HStack(spacing: 0) {
                    if let dollars = line.dollars {
                        Text(dollars + " · ").foregroundStyle(Theme.textTertiary)
                    }
                    Text(line.statusText).foregroundStyle(line.statusColor)
                }
                .font(.system(size: 13))
                .monospacedDigit()
            }
        }
        .foregroundStyle(Theme.textPrimary)
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(minHeight: 74)
        .background(boxed ? Theme.surface : .clear, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: 20))
        .accessibilityElement(children: .combine)
    }
}

/// A white arc turning around a mark: the money is on its way.
struct SpinningRing: View {
    @State private var turning = false

    var body: some View {
        Circle()
            .trim(from: 0, to: 0.7)
            .stroke(Color.white, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
            .rotationEffect(.degrees(turning ? 360 : 0))
            .onAppear { withAnimation(.linear(duration: 1).repeatForever(autoreverses: false)) { turning = true } }
            .accessibilityLabel("On its way")
    }
}
