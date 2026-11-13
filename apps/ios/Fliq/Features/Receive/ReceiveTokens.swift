import SwiftUI
import UIKit

/// The QR receive screen behind Home's top-right button: pick a token and network, get an address to scan or share.
/// USDC on NEAR, the user's own account, is the default everywhere; other networks are choices in the dropdown.
@MainActor
@Observable
final class ReceiveTokensModel {
    let flow: ReceiveFlow
    private(set) var token: String?
    private(set) var source: DepositSource?

    init(flow: ReceiveFlow) {
        self.flow = flow
    }

    /// Tokens with at least one network that works here, USDC first.
    var tokens: [String] {
        var seen: [String] = []
        for source in flow.offered where !seen.contains(source.tokenId) { seen.append(source.tokenId) }
        return seen.sorted { lhs, rhs in (lhs == "usdc" ? 0 : 1, lhs) < (rhs == "usdc" ? 0 : 1, rhs) }
    }

    var networks: [DepositSource] {
        token.map(flow.networks(for:)) ?? []
    }

    var canPickToken: Bool { tokens.count > 1 }
    var canPickNetwork: Bool { networks.count > 1 }

    /// The address for the chosen network, once reserved.
    var address: DepositAddress? {
        guard let source, let deposit = flow.deposit, deposit.source == source else { return nil }
        return deposit
    }

    func load() async {
        await flow.loadSources()
        choose(token: tokens.first)
        await reserveIfNeeded()
    }

    func pick(token: String) async {
        guard token != self.token else { return }
        choose(token: token)
        await reserveIfNeeded()
    }

    func pick(network: DepositSource) async {
        guard network != source else { return }
        source = network
        await reserveIfNeeded()
    }

    /// Reserves an address for the chosen network unless a live one is already held. A network the server refuses
    /// drops out of `offered`, so the choice falls back to what is still there.
    func reserveIfNeeded(at now: Date = .now) async {
        for _ in 0..<4 {
            guard let source else { return }
            if let address, address.reservedUntil > now { return }
            if await flow.reserve(source) { return }
            if !tokens.contains(token ?? "") { choose(token: tokens.first) } else { choose(token: token) }
        }
    }

    private func choose(token: String?) {
        self.token = token
        let options = token.map(flow.networks(for:)) ?? []
        source = options.first(where: \.isDirect) ?? options.first
    }

    /// "HYC7S2…r1V9wz": long addresses keep both ends, which is what people compare. NEAR names such as
    /// frank.fliqaccount.near are read, not compared, so they stay whole.
    static func shortened(_ address: String, keep: Int = 6) -> String {
        guard address.count > keep * 2 + 1, !address.contains(".") else { return address }
        return "\(address.prefix(keep))…\(address.suffix(keep))"
    }
}

struct ReceiveTokensView: View {
    @State var model: ReceiveTokensModel
    let inbox: WalletInbox
    let name: String?
    let onClose: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                if model.flow.isLoading && model.source == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 80)
                } else if let source = model.source {
                    pickers(source)
                    banner(source)
                    codeCard(source)
                    addressCard(source)
                    if source.isDirect {
                        WalletArrivedCard(inbox: inbox).padding(.top, 16)
                    }
                } else {
                    Text(model.flow.errorMessage ?? "Nothing can be received right now. Try again in a moment.")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.top, 40)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .scrollIndicators(.hidden)
        .task { await model.load() }
        .task(id: model.address?.reservedUntil) { await renewWhenExpired() }
        .task(id: model.source) { if model.source?.isDirect == true { await inbox.load() } }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Receive Tokens").font(.system(size: 22, weight: .semibold))
                Text("Deposit USDC or USDT to your wallet")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            Button(action: onClose) {
                Icon("xmark", size: 18)
                    .foregroundStyle(.black)
                    .frame(width: 36, height: 36)
                    .background(Color.white, in: Circle())
            }
            .accessibilityLabel("Close")
        }
        .padding(.top, 24)
        .padding(.bottom, 24)
    }

    private func pickers(_ source: DepositSource) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Token").font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
            Menu {
                ForEach(model.tokens, id: \.self) { token in
                    Button(token.uppercased()) { Task { await model.pick(token: token) } }
                }
            } label: {
                PickerRow(title: source.token, pickable: model.canPickToken) { TokenLogo(token: source.token, size: 28) }
            }
            .disabled(!model.canPickToken)

            Text("Network").font(.system(size: 14)).foregroundStyle(Theme.textSecondary).padding(.top, 12)
            Menu {
                ForEach(model.networks) { network in
                    Button(network.chain) { Task { await model.pick(network: network) } }
                }
            } label: {
                PickerRow(title: source.chain, pickable: model.canPickNetwork) { ChainLogo(source: source, size: 28) }
            }
            .disabled(!model.canPickNetwork)
        }
    }

    private func banner(_ source: DepositSource) -> some View {
        HStack(spacing: 12) {
            Icon("info.circle.fill", size: 22).foregroundStyle(Theme.warning)
            Text("To avoid loss of funds, only send \(source.token) on \(source.chain) to this address.")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Theme.warning)
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(Theme.warning.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
        .padding(.top, 20)
    }

    private func codeCard(_ source: DepositSource) -> some View {
        Group {
            if let address = model.address {
                QRCode(text: address.address, color: .white) {
                    ChainLogo(source: source, size: 44)
                        .padding(8)
                        .background(Color.black, in: RoundedRectangle(cornerRadius: 16))
                }
                .padding(22)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(width: 260, height: 260)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 28))
        .frame(maxWidth: .infinity)
        .padding(.top, 24)
    }

    private func addressCard(_ source: DepositSource) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(source.chain.uppercased()) ADDRESS")
                        .font(.system(size: 12, weight: .semibold))
                        .tracking(0.8)
                        .foregroundStyle(Theme.textSecondary)
                    if source.isDirect, let name {
                        Text(FliqName.display(name)).font(.system(size: 16, weight: .semibold))
                    }
                    Text(model.address.map { ReceiveTokensModel.shortened($0.address) } ?? "…")
                        .font(.system(size: 15, design: .monospaced))
                        .foregroundStyle(source.isDirect ? Theme.textSecondary : Theme.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer(minLength: 8)
                if let address = model.address {
                    CopyButton(text: address.address)
                    ShareLink(item: address.address, message: Text("My \(source.token) on \(source.chain) address")) {
                        Icon("square.and.arrow.up", size: 20)
                            .frame(width: 48, height: 48)
                            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .accessibilityLabel("Share address")
                }
            }
            if let address = model.address, !source.isDirect, address.reservedUntil < .distantFuture {
                Text("Address valid until \(address.reservedUntil.formatted(date: .omitted, time: .shortened))")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .padding(18)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22))
        .padding(.top, 20)
        .foregroundStyle(Theme.textPrimary)
    }

    private func renewWhenExpired() async {
        guard let until = model.address?.reservedUntil, until < .distantFuture else { return }
        try? await Task.sleep(for: .seconds(max(1, until.timeIntervalSinceNow)))
        guard !Task.isCancelled else { return }
        await model.reserveIfNeeded()
    }
}

private struct PickerRow<Logo: View>: View {
    let title: String
    let pickable: Bool
    @ViewBuilder var logo: () -> Logo

    var body: some View {
        HStack(spacing: 12) {
            logo()
            Text(title).font(.system(size: 17, weight: .medium)).foregroundStyle(Theme.textPrimary)
            Spacer()
            if pickable {
                Icon("chevron.down", size: 18).foregroundStyle(Theme.textSecondary)
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 60)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.white.opacity(0.06)))
        .contentShape(Rectangle())
    }
}

private struct CopyButton: View {
    let text: String
    @State private var copied = false

    var body: some View {
        Button {
            UIPasteboard.general.string = text
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            copied = true
            Task {
                try? await Task.sleep(for: .seconds(1.5))
                copied = false
            }
        } label: {
            Icon(copied ? "checkmark" : "doc.on.doc", size: 20)
                .frame(width: 48, height: 48)
                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 14))
        }
        .accessibilityLabel(copied ? "Copied" : "Copy address")
    }
}
