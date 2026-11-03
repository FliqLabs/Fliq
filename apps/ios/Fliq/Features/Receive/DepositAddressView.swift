import SwiftUI
import UIKit

struct DepositAddressView: View {
    let flow: ReceiveFlow
    @Environment(AppEnvironment.self) private var environment
    @State private var copied = false

    var body: some View {
        if let deposit = flow.deposit {
            content(deposit)
        }
    }

    private func content(_ deposit: DepositAddress) -> some View {
        VStack(spacing: 0) {
            Text(heading(deposit))
                .font(.system(size: 22, weight: .semibold))
                .multilineTextAlignment(.center)
                .padding(.top, 28)

            if deposit.isDemo {
                Label("Demo address. Don't send real funds to it.", systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.warning)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Theme.warning.opacity(0.12), in: Capsule())
                    .padding(.top, 14)
            }

            QRCode(text: deposit.address)
                .padding(16)
                .frame(width: 232, height: 232)
                .background(.white, in: RoundedRectangle(cornerRadius: 20))
                .padding(.top, 20)

            HStack(spacing: 8) {
                Button {
                    UIPasteboard.general.string = deposit.address
                    copied = true
                } label: {
                    HStack(spacing: 10) {
                        Text(Self.short(deposit.address)).font(.system(size: 15, design: .monospaced))
                        Image(systemName: copied ? "checkmark" : "doc.on.doc").font(.system(size: 14))
                    }
                    .padding(.horizontal, 16)
                    .frame(height: 44)
                    .background(Theme.field, in: Capsule())
                }
                .accessibilityLabel(copied ? "Address copied" : "Copy address")
                ShareLink(item: deposit.address) {
                    Image(systemName: "square.and.arrow.up")
                        .frame(width: 44, height: 44)
                        .background(Theme.field, in: Circle())
                }
                .accessibilityLabel("Share address")
            }
            .foregroundStyle(Theme.textPrimary)
            .padding(.top, 22)

            if !deposit.source.isDirect {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    reservation(deposit, now: context.date)
                }
                .padding(.top, 26)
            }

            Spacer()

            Button("I have sent it") { environment.router.push(.receiveArriving) }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.bottom, 12)
        }
        .fliqScreen()
        .toolbar {
            ToolbarItem(placement: .principal) {
                HStack(spacing: 8) {
                    SourceBadge(source: deposit.source, size: 26)
                    Text(deposit.source.title)
                }
                .font(.system(size: 14, weight: .medium))
                .fixedSize()
            }
        }
    }

    private func reservation(_ deposit: DepositAddress, now: Date) -> some View {
        let left = flow.secondsLeft(at: now)
        return VStack(spacing: 10) {
            HStack {
                Text("Reserved for you until \(deposit.reservedUntil.formatted(date: .omitted, time: .shortened))")
                Spacer()
                Text(Duration.seconds(left).formatted(.time(pattern: .minuteSecond)))
                    .foregroundStyle(Theme.textPrimary)
                    .fontWeight(.medium)
                    .monospacedDigit()
            }
            .font(.system(size: 13))
            .foregroundStyle(Theme.textSecondary)
            ProgressView(value: Double(left), total: FixtureDepositAPI.watchWindow).tint(.white)
            Text("We watch this address for 10 minutes. Nothing sent is lost.")
                .font(.system(size: 13))
                .foregroundStyle(Color(hex: 0x8E8E8E))
                .multilineTextAlignment(.center)
                .padding(.top, 4)
        }
    }

    private func heading(_ deposit: DepositAddress) -> String {
        if deposit.source.isDirect { return "Send \(deposit.source.token) on NEAR\nto your vault" }
        let amount = Money.dollars(deposit.expected)
        return "Send about \(amount) \(deposit.source.token)\non \(deposit.source.chain) only"
    }

    static func short(_ address: String) -> String {
        guard address.count > 14 else { return address }
        return "\(address.prefix(6))…\(address.suffix(4))"
    }
}
