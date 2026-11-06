import SwiftUI
import UIKit

struct DepositAddressView: View {
    let flow: ReceiveFlow
    @Environment(AppEnvironment.self) private var environment
    @State private var copied = false

    var body: some View {
        if let deposit = flow.deposit {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                content(deposit, expired: !deposit.source.isDirect && flow.secondsLeft(at: context.date) == 0, now: context.date)
            }
        }
    }

    private func content(_ deposit: DepositAddress, expired: Bool, now: Date) -> some View {
        VStack(spacing: 0) {
            Text(heading(deposit))
                .font(.system(size: 22, weight: .semibold))
                .tracking(-0.44)
                .lineSpacing(2)
                .multilineTextAlignment(.center)
                .padding(.top, 36)

            Text(amountRule(deposit))
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .padding(.top, 10)

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
                .blur(radius: expired ? 10 : 0)
                .opacity(expired ? 0.25 : 1)
                .overlay {
                    if expired {
                        Text("This address has expired")
                            .font(.system(size: 17, weight: .semibold))
                            .multilineTextAlignment(.center)
                    }
                }
                .accessibilityHidden(expired)
                .padding(.top, 24)

            HStack(spacing: 8) {
                Button {
                    UIPasteboard.general.string = deposit.address
                    copied = true
                } label: {
                    HStack(spacing: 10) {
                        Text(Self.short(deposit.address)).font(.system(size: 15, design: .monospaced))
                        Image(systemName: copied ? "checkmark" : "square.on.square").font(.system(size: 15))
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
            .opacity(expired ? 0.3 : 1)
            .disabled(expired)
            .padding(.top, 22)

            if !deposit.source.isDirect {
                reservation(deposit, now: now)
                    .padding(.top, 26)
            }

            Spacer()

            if expired {
                Button("Get a new address") { Task { _ = await flow.reserve() } }
                    .buttonStyle(PrimaryButtonStyle(filled: true))
                    .disabled(flow.isReserving)
                    .padding(.bottom, 6)
            } else {
                Button("I have sent it") { environment.router.push(.receiveArriving) }
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.bottom, 6)
            }
        }
        .fliqScreen()
        .toolbar {
            ToolbarItem(placement: .principal) {
                HStack(spacing: 8) {
                    SourceBadge(source: deposit.source, size: 26, ring: Theme.field)
                    Text(deposit.source.title)
                }
                .font(.system(size: 14, weight: .medium))
                .padding(.leading, 6)
                .padding(.trailing, 12)
                .frame(height: 36)
                .background(Theme.field, in: Capsule())
                .fixedSize()
            }
        }
    }

    private func reservation(_ deposit: DepositAddress, now: Date) -> some View {
        let left = flow.secondsLeft(at: now)
        return VStack(spacing: 10) {
            HStack {
                Text("Open until \(deposit.reservedUntil.formatted(date: .omitted, time: .shortened))")
                Spacer()
                Text(Duration.seconds(left).formatted(.time(pattern: .minuteSecond)))
                    .foregroundStyle(Theme.textPrimary)
                    .fontWeight(.medium)
                    .monospacedDigit()
            }
            .font(.system(size: 13))
            .foregroundStyle(Theme.textSecondary)
            GeometryReader { proxy in
                Capsule().fill(Color(hex: 0x262626))
                    .overlay(alignment: .leading) {
                        Rectangle().fill(.white)
                            .frame(width: proxy.size.width * min(1, Double(left) / FixtureDepositAPI.watchWindow))
                    }
                    .clipShape(Capsule())
            }
            .frame(height: 2)
            .animation(.linear(duration: 1), value: left)
            Text("Send within 10 minutes. After that, get a new address.")
                .font(.system(size: 13))
                .foregroundStyle(Color(hex: 0x8E8E8E))
                .multilineTextAlignment(.center)
                .padding(.top, 4)
        }
    }

    private func heading(_ deposit: DepositAddress) -> String {
        if deposit.source.isDirect { return "Send \(deposit.source.token) on NEAR\nto your vault" }
        return "Send \(deposit.source.token)\non \(deposit.source.chain) only"
    }

    private func amountRule(_ deposit: DepositAddress) -> String {
        if deposit.source.isDirect { return "Any amount. This address never changes." }
        return "Any amount over $\(Money.dollars(deposit.minimum))"
    }

    static func short(_ address: String) -> String {
        guard address.count > 14 else { return address }
        return "\(address.prefix(6))…\(address.suffix(4))"
    }
}
