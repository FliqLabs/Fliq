import SwiftUI

struct ReceiveAmountView: View {
    let flow: ReceiveFlow
    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 10) {
                Text("About how much will you send?")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(flow.amountText.isEmpty ? "0" : flow.amountText)
                        .font(Theme.hero())
                        .tracking(-1.9)
                    Text(flow.source?.token ?? "")
                        .font(.system(size: 24))
                        .foregroundStyle(Theme.textSecondary)
                }
                landing
            }
            Spacer()

            Button {
                Task { if await flow.reserve() { environment.router.push(.receiveAddress) } }
            } label: {
                if flow.isReserving { ProgressView() } else { Text("Get address") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!flow.canReserve)
            .padding(.bottom, 12)

            Keypad(onKey: flow.tapKey)
        }
        .fliqScreen(aurora: Aurora(accent: Color(hex: 0x4D3DFF).opacity(0.77), strength: 0.72))
        .toolbar {
            ToolbarItem(placement: .principal) {
                if let source = flow.source {
                    Button { dismiss() } label: {
                        HStack(spacing: 8) {
                            SourceBadge(source: source, size: 26, ring: Color(hex: 0x1C1C1C))
                            Text(source.title).font(.system(size: 14, weight: .medium))
                            Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                        }
                        .padding(.leading, 6)
                        .padding(.trailing, 12)
                        .frame(height: 36)
                        .fliqGlass(Capsule(), interactive: true)
                    }
                    .foregroundStyle(Theme.textPrimary)
                    .fixedSize()
                    .accessibilityLabel("Change network, \(source.title)")
                }
            }
        }
    }

    @ViewBuilder
    private var landing: some View {
        Group {
            if flow.belowMinimum, let minimum = flow.source?.minimum {
                Text("Minimum on \(flow.source?.chain ?? "") is $\(Money.dollars(minimum))")
                    .foregroundStyle(Theme.warning)
            } else if let lands = flow.estimatedLanding, lands > .zero {
                Text("Lands as \(Text("$" + lands.decimalString).foregroundStyle(Theme.textPrimary).fontWeight(.medium)) in about \(flow.source?.group == .bitcoin ? "10 min" : "35s")")
                    .foregroundStyle(Theme.textSecondary)
            } else {
                Text("Any amount, the address takes what you send")
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .font(.system(size: 14))
        .padding(.horizontal, 14)
        .frame(height: 36)
        .fliqGlass(Capsule())
        .padding(.top, 4)
    }
}
