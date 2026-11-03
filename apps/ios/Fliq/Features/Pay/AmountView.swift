import SwiftUI

struct AmountView: View {
    let flow: PayFlow
    @Environment(AppEnvironment.self) private var environment

    private let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"]

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 10) {
                Text("They receive")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                HeroAmount(symbol: Currency.ngn.symbol, value: (flow.estimatedReceive ?? 0).formatted())
                Label {
                    Text("You send \(Text("$" + (flow.amountText.isEmpty ? "0" : flow.amountText)).foregroundStyle(Theme.textPrimary).fontWeight(.medium))")
                } icon: {
                    Image(systemName: "arrow.up.arrow.down")
                }
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
                .padding(.horizontal, 14)
                .frame(height: 36)
                .background(Color.white.opacity(0.08), in: Capsule())
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.12)))

                if let rate = flow.rate {
                    Text("$1 = \(Money.rate(rate.rate, rate.currency))")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.top, 6)
                }
            }
            Spacer()

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
            .disabled((flow.amount ?? .zero) <= .zero || flow.isQuoting)
            .padding(.bottom, 12)

            keypad
        }
        .fliqScreen()
        .toolbar {
            ToolbarItem(placement: .principal) { recipientChip }
        }
        .task { await flow.loadRate() }
    }

    @ViewBuilder
    private var recipientChip: some View {
        if let verified = flow.verified {
            HStack(spacing: 8) {
                Image(systemName: "building.columns.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                Text(verified.accountName)
            }
                .font(.system(size: 14, weight: .medium))
                .fixedSize()
                .padding(.horizontal, 12)
                .frame(height: 36)
                .background(Color.white.opacity(0.08), in: Capsule())
        }
    }

    private var keypad: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 0) {
            ForEach(keys, id: \.self) { key in
                Button { flow.tapKey(key) } label: {
                    Group {
                        if key == "⌫" {
                            Image(systemName: "delete.left").font(.system(size: 22))
                        } else {
                            Text(key).font(.system(size: 26))
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 54)
                    .contentShape(Rectangle())
                }
                .foregroundStyle(Theme.textPrimary)
                .accessibilityLabel(key == "⌫" ? "Delete" : key)
            }
        }
        .padding(.vertical, 10)
        .background(Color(hex: 0x0A0A0A).ignoresSafeArea(edges: .bottom))
        .padding(.horizontal, -16)
    }
}

#Preview {
    NavigationStack {
        AmountView(flow: PayFlow(api: FixtureClient()))
    }
    .environment(AppEnvironment.preview)
}
