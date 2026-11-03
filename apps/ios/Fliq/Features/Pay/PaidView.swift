import SwiftUI

struct PaidView: View {
    let flow: PayFlow
    let onPayAgain: () -> Void
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        if let payout = flow.payout {
            content(payout)
        }
    }

    private func content(_ payout: Payout) -> some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                Image(systemName: "checkmark")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(Theme.confirmed)
                    .frame(width: 72, height: 72)
                    .background(Color(hex: 0x0F2E19), in: Circle())
                    .padding(.bottom, 8)
                HeroAmount(symbol: payout.currency.symbol, value: payout.receive.formatted())
                Text("landed in \(payout.accountName)'s account")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textSecondary)
                if let settledLine = settledLine(payout) {
                    Text(settledLine)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textTertiary)
                }
            }
            .padding(.top, 36)

            DetailCard {
                DetailRow("Sent", "$" + payout.amount.decimalString)
                DetailRow("Rate after fees", "$1 = " + Money.rate(payout.rate, payout.currency))
                DetailRow("Paid out by", payout.provider.displayName, isLast: payout.bankReference == nil)
                if let reference = payout.bankReference {
                    DetailRow(label: "NIP session", isLast: true) {
                        Text(reference).font(.system(size: 13, design: .monospaced))
                    }
                }
            }
            .padding(.top, 30)

            ShareLink(item: receipt(payout)) {
                Label("Share receipt", systemImage: "square.and.arrow.up")
                    .font(.system(size: 15, weight: .medium))
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
            }
            .foregroundStyle(Theme.textPrimary)
            .padding(.top, 10)

            Spacer()

            Button("Pay again", action: onPayAgain)
                .buttonStyle(PrimaryButtonStyle())
                .padding(.bottom, 12)
        }
        .fliqScreen("Paid")
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { environment.router.reset() } label: { Image(systemName: "xmark") }
                    .accessibilityLabel("Close")
            }
        }
    }

    private func settledLine(_ payout: Payout) -> String? {
        guard let settled = payout.history.last(where: { $0.state == .settled }) else { return nil }
        let time = settled.at.formatted(date: .omitted, time: .standard)
        guard let seconds = payout.seconds else { return time }
        return "\(time) · \(seconds) seconds"
    }

    private func receipt(_ payout: Payout) -> String {
        var lines = [
            "fliq receipt",
            "\(Money.local(payout.receive, payout.currency)) to \(payout.accountName)",
            "Sent $\(payout.amount.decimalString) at $1 = \(Money.rate(payout.rate, payout.currency))",
            "Paid out by \(payout.provider.displayName)",
        ]
        if let reference = payout.bankReference { lines.append("NIP session \(reference)") }
        if let receipt = payout.vaultReceipt { lines.append("Vault receipt \(receipt)") }
        return lines.joined(separator: "\n")
    }
}
