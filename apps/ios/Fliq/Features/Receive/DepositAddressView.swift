import SwiftUI
import UIKit

/// The address to send to, on one network: who it belongs to, a QR code, what lands and when, and one big Copy.
struct DepositAddressView: View {
    let flow: ReceiveFlow
    /// Called once the transfer shows up on its chain, to move on to Arriving.
    let onSeen: () -> Void
    @State private var copied = false
    @State private var showingInfo = false

    var body: some View {
        if let deposit = flow.deposit {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                content(deposit, expired: !deposit.source.isDirect && flow.secondsLeft(at: context.date) == 0, now: context.date)
            }
            .task(id: deposit.address) { await flow.track() }
            .onChange(of: flow.status?.stage) { _, stage in
                if let stage, stage >= .seen { onSeen() }
            }
        }
    }

    private func content(_ deposit: DepositAddress, expired: Bool, now: Date) -> some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    title(deposit)
                    if deposit.isDemo {
                        Label("Demo address. Don't send real money to it.", systemImage: "exclamationmark.triangle.fill")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.warning)
                            .padding(.top, 14)
                    }
                    card(deposit, expired: expired)
                        .padding(.top, 22)
                    details(deposit, now: now)
                        .padding(.top, 8)
                    TestNetworkNote(network: flow.network)
                        .padding(.top, 16)
                }
                .padding(.horizontal, 16)
            }
            .scrollIndicators(.hidden)

            Group {
                if expired {
                    Button("Get a new address") { Task { _ = await flow.reserve(deposit.source) } }
                        .buttonStyle(PrimaryButtonStyle(filled: true))
                        .disabled(flow.isReserving)
                } else {
                    Button(copied ? "Copied" : "Copy address") { copy(deposit.address) }
                        .buttonStyle(PrimaryButtonStyle(filled: true))
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(item: deposit.address, subject: Text("My \(deposit.source.token) address on \(deposit.source.chain)")) {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("Share address")
            }
        }
        .sheet(isPresented: $showingInfo) {
            DepositInfoSheet(deposit: deposit)
                .presentationDetents([.medium, .large])
                .presentationBackground(Color(hex: 0x161616))
        }
        .sensoryFeedback(.success, trigger: copied)
    }

    private func title(_ deposit: DepositAddress) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Receive \(deposit.source.token)")
                .font(.system(size: 32, weight: .bold))
                .tracking(-0.7)
            networkSwitcher(deposit)
        }
        .padding(.top, 4)
    }

    @ViewBuilder
    private func networkSwitcher(_ deposit: DepositAddress) -> some View {
        let others = flow.networks(for: deposit.source.tokenId).filter { $0 != deposit.source && flow.reason(unavailable: $0) == nil }
        let label = HStack(spacing: 6) {
            Text("on the").foregroundStyle(Theme.textSecondary)
            ChainLogo(source: deposit.source, size: 22)
            Text(deposit.source.isDirect ? "NEAR network" : "\(deposit.source.chain) network")
            if !others.isEmpty {
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textSecondary)
            }
        }
        .font(.system(size: 17, weight: .medium))

        if others.isEmpty {
            label
        } else {
            Menu {
                ForEach(others) { source in
                    Button("\(source.chain) · \(source.eta)") { Task { _ = await flow.reserve(source) } }
                }
            } label: { label }
                .foregroundStyle(Theme.textPrimary)
                .accessibilityLabel("Network: \(deposit.source.chain). Change network")
        }
    }

    private func card(_ deposit: DepositAddress, expired: Bool) -> some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    PersonAvatar(name: flow.name ?? "f", size: 26)
                    Text(flow.name.map { $0.split(separator: ".").first.map(String.init) ?? $0 } ?? "Your vault")
                        .font(.system(size: 16, weight: .semibold))
                        .lineLimit(1)
                }
                Spacer(minLength: 24)
                Text("Address").font(.system(size: 15, weight: .medium))
                Button { copy(deposit.address) } label: {
                    HStack(spacing: 8) {
                        Text(Self.short(deposit.address)).font(.system(size: 15, design: .monospaced)).foregroundStyle(Theme.textSecondary)
                        Image(systemName: copied ? "checkmark" : "doc.on.doc").font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
                    }
                }
                .padding(.top, 4)
                .accessibilityLabel(copied ? "Address copied" : "Copy address")
                if let memo = deposit.memo {
                    Text("Memo \(memo)")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.warning)
                        .padding(.top, 6)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            QRCode(text: deposit.address, color: .white) {
                SourceBadge(source: deposit.source, size: 34, ring: Color(hex: 0x1C1C1C))
                    .padding(4)
                    .background(Color(hex: 0x1C1C1C), in: Circle())
            }
            .frame(width: 132, height: 132)
            .blur(radius: expired ? 8 : 0)
            .opacity(expired ? 0.3 : 1)
            .overlay {
                if expired { Text("Expired").font(.system(size: 15, weight: .semibold)) }
            }
        }
        .padding(18)
        .frame(minHeight: 170)
        .fliqGlass(RoundedRectangle(cornerRadius: 28))
    }

    private func details(_ deposit: DepositAddress, now: Date) -> some View {
        VStack(spacing: 0) {
            DetailRow("Arrives as", deposit.source.group == .bitcoin ? "USDC in your vault" : "1 \(deposit.source.token) ≈ $1.00")
            DetailRow("Minimum", deposit.minimum == .zero ? "Any amount" : "\(deposit.source.group == .bitcoin ? deposit.minimum.decimalString : Money.dollars(deposit.minimum)) \(deposit.source.token)")
            DetailRow("Fees", deposit.fee == .zero ? "None" : "≈ $\(deposit.fee.decimalString)")
            DetailRow("Arrives in", deposit.source.eta)
            if !deposit.source.isDirect {
                DetailRow("Address open for", Duration.seconds(flow.secondsLeft(at: now)).formatted(.time(pattern: .minuteSecond)))
            }
            Button { showingInfo = true } label: {
                HStack {
                    Text("Learn more about deposits").foregroundStyle(Theme.textSecondary)
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.textTertiary)
                }
                .font(.system(size: 15))
                .padding(.horizontal, 16)
                .padding(.vertical, 15)
                .contentShape(Rectangle())
            }
        }
    }

    private func copy(_ address: String) {
        UIPasteboard.general.string = address
        copied = true
    }

    static func short(_ address: String) -> String {
        guard address.count > 16 else { return address }
        return "\(address.prefix(8))…\(address.suffix(5))"
    }
}

/// How a top-up works, for the network it is on.
private struct DepositInfoSheet: View {
    let deposit: DepositAddress
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            SourceBadge(source: deposit.source, size: 64, ring: Color(hex: 0x161616))
                .padding(.top, 28)
            Text("\(deposit.source.token) on \(deposit.source.chain)")
                .font(.system(size: 24, weight: .bold))
                .padding(.top, 14)
            VStack(spacing: 0) {
                item("arrow.down.to.line", "How it lands", deposit.source.isDirect
                     ? "Sent straight into your vault on NEAR."
                     : "NEAR Intents moves it to NEAR and your vault receives it as USDC.")
                item("tag", "Fees", deposit.fee == .zero ? "fliq charges nothing to receive." : "About $\(deposit.fee.decimalString) in network and NEAR Intents fees. fliq adds nothing.")
                item("exclamationmark.shield", "Only this network", "Send \(deposit.source.token) on \(deposit.source.chain) only. Other coins or networks sent here can be lost.")
                item("arrow.uturn.backward", "If something goes wrong", "Less than the minimum, or a transfer that can't finish, is refunded to your NEAR account.", isLast: true)
            }
            .padding(.top, 20)
            Spacer()
            Button("Done") { dismiss() }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.bottom, 12)
        }
        .padding(.horizontal, 20)
    }

    private func item(_ symbol: String, _ title: String, _ detail: String, isLast: Bool = false) -> some View {
        HStack(alignment: .top, spacing: 16) {
            Image(systemName: symbol).font(.system(size: 18)).foregroundStyle(Theme.textSecondary).frame(width: 24)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.system(size: 17, weight: .semibold))
                Text(detail).font(.system(size: 15)).foregroundStyle(Theme.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 14)
        .overlay(alignment: .bottom) {
            if !isLast { Rectangle().fill(Color.white.opacity(0.07)).frame(height: 1).padding(.leading, 40) }
        }
    }
}
