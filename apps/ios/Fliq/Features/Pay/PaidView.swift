import SwiftUI

/// The receipt for a settled payout. Opened at the end of Pay, and from Activity.
struct PaidView: View {
    let payout: Payout
    var onPayAgain: (() -> Void)?
    @Environment(AppEnvironment.self) private var environment
    @State private var showingNotReceived = false

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                Image(systemName: "checkmark")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(Theme.confirmed)
                    .frame(width: 72, height: 72)
                    .background(Color(hex: 0x0F2E19), in: Circle())
                    .padding(.bottom, 8)
                HeroAmount(symbol: payout.currency.symbol, value: payout.receive.formatted())
                Text("landed in \(payout.accountName)'s \(payout.institutionName) account")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                if let settledLine {
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

            ShareLink(item: receipt) {
                Label("Share receipt", systemImage: "square.and.arrow.up")
                    .font(.system(size: 15, weight: .medium))
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
            }
            .foregroundStyle(Theme.textPrimary)
            .padding(.top, 10)

            Spacer()

            Button("Not received yet?") { showingNotReceived = true }
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
                .frame(height: 40)
                .padding(.bottom, 14)

            if let onPayAgain {
                Button("Pay again", action: onPayAgain)
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.bottom, 12)
            }
        }
        .fliqScreen("Paid")
        .navigationBarBackButtonHidden(onPayAgain != nil)
        .toolbar {
            if onPayAgain != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { environment.router.reset() } label: { Image(systemName: "xmark") }
                        .accessibilityLabel("Close")
                }
            }
        }
        .sheet(isPresented: $showingNotReceived) {
            NotReceivedSheet(payout: payout)
                .presentationDetents([.medium])
        }
    }

    private var settledLine: String? {
        guard let settled = payout.history.last(where: { $0.state == .settled }) else { return nil }
        let time = settled.at.formatted(date: .omitted, time: .standard)
        guard let seconds = payout.seconds else { return time }
        return "\(time) · \(seconds) seconds"
    }

    private var receipt: String {
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

extension Payout {
    var institutionName: String {
        Institution.supported.first { $0.code == account.bank }?.name ?? "bank"
    }
}
