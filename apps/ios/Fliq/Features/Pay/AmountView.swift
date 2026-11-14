import SwiftUI

struct AmountView: View {
    let flow: PayFlow
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            amount
            Spacer()
            AmountKeypad(text: flow.amountText, onType: flow.enterAmount)
                .padding(.bottom, 12)

            if let message = flow.errorMessage {
                Text(message)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.warning)
                    .padding(.bottom, 8)
            }

            Button {
                Task {
                    if await flow.fetchQuote() { environment.router.push(.payQuote) }
                }
            } label: {
                if flow.isQuoting { ProgressView() } else { Text("Get quote") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled((flow.amount ?? .zero) <= .zero || flow.isOverBalance || flow.isQuoting)
            .padding(.bottom, 12)
        }
        .fliqScreen()
        .toolbar {
            ToolbarItem(placement: .principal) { recipientChip }
        }
        .task { await flow.loadRate() }
    }

    private var amount: some View {
        VStack(spacing: 10) {
            Text(typesDollars ? "You send" : "They receive")
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
            HeroAmount(symbol: typesDollars ? "$" : flow.currency.symbol, value: Money.typed(flow.amountText))
            Button {
                flow.switchUnit()
            } label: {
                Label {
                    Text("\(typesDollars ? "They receive" : "You send") \(Text(otherAmount).foregroundStyle(Theme.textPrimary).fontWeight(.medium))")
                } icon: {
                    Icon("arrow.up.arrow.down")
                }
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
                .padding(.horizontal, 14)
                .frame(height: 36)
                .fliqGlass(Capsule(), interactive: true)
            }
            .buttonStyle(.plain)
            .disabled(!flow.canSwitchUnit)
            .accessibilityHint(typesDollars ? "Type in \(flow.currency.rawValue.uppercased()) instead" : "Type in dollars instead")

            if let rate = flow.rate {
                Text("$1 = \(Money.rate(rate.rate, rate.currency))")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.top, 6)
            }
            Text(flow.isOverBalance ? "More than the $\(Money.dollars(flow.available)) in your vault" : "In your vault $\(Money.dollars(flow.available))")
                .font(.system(size: 14))
                .foregroundStyle(flow.isOverBalance ? Theme.warning : Theme.textTertiary)
                .padding(.top, 2)
        }
    }

    private var typesDollars: Bool { flow.unit == .dollars }

    private var otherAmount: String {
        typesDollars
            ? Money.local(flow.estimatedReceive ?? 0, flow.currency)
            : "$" + Money.dollars(flow.amount ?? .zero)
    }

    @ViewBuilder
    private var recipientChip: some View {
        if let verified = flow.verified {
            HStack(spacing: 8) {
                Icon("building.columns.fill", size: 14)
                    .foregroundStyle(Theme.textSecondary)
                Text(verified.accountName)
            }
                .font(.system(size: 14, weight: .medium))
                .fixedSize()
                .padding(.horizontal, 12)
                .frame(height: 36)
                .fliqGlass(Capsule())
        }
    }
}

#Preview {
    NavigationStack {
        AmountView(flow: PayFlow(api: FixtureClient()))
    }
    .environment(AppEnvironment.preview)
}
