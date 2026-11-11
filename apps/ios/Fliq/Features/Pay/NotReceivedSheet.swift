import SwiftUI
import UIKit

struct NotReceivedSheet: View {
    let payout: Payout
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Spacer().frame(width: 32)
                Spacer()
                Text("Not received yet?").font(.system(size: 17, weight: .semibold))
                Spacer()
                Button { dismiss() } label: { Icon("xmark") }
                    .frame(width: 32, height: 32)
                    .accessibilityLabel("Close")
            }
            .padding(.top, 20)

            Text(summary)
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .lineSpacing(4)

            VStack(spacing: 0) {
                if let reference = payout.bankReference {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Give \(payout.institutionName) this NIP Session ID")
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textSecondary)
                            Text(reference).font(.system(size: 15, design: .monospaced))
                        }
                        Spacer()
                        Button {
                            UIPasteboard.general.string = reference
                            copied = true
                        } label: {
                            Icon(copied ? "checkmark" : "doc.on.doc", size: 18)
                                .frame(width: 36, height: 36)
                                .background(Color(hex: 0x2A2A2A), in: RoundedRectangle(cornerRadius: 10))
                        }
                        .accessibilityLabel(copied ? "Copied" : "Copy session ID")
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .overlay(alignment: .bottom) { Rectangle().fill(Color(hex: 0x2A2A2A)).frame(height: 1) }
                }
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Paid out by")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                        Text(payout.provider.displayName).font(.system(size: 15, weight: .medium))
                    }
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
            }
            .background(Color(hex: 0x1E1E1E), in: RoundedRectangle(cornerRadius: 16))
            .padding(.top, 6)

            Spacer()
        }
        .padding(.horizontal, 16)
        .foregroundStyle(Theme.textPrimary)
    }

    private var summary: String {
        let bank = payout.institutionName
        guard let settled = payout.history.last(where: { $0.state == .settled }) else {
            return "\(bank) hasn't confirmed this payout yet."
        }
        let time = settled.at.formatted(date: .omitted, time: .standard)
        return "\(bank) confirmed receipt at \(time).\nLate credits usually land within the hour and cannot be sent twice."
    }
}
