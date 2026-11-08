import SwiftUI
import UIKit

/// Send, Receive and Request, as one sheet that moves forward in place and grows to full height after the menu.
struct MoneySheet: View {
    enum Start: Identifiable {
        case menu, receive

        var id: Self { self }
    }

    enum Step: Hashable {
        case payTo, receive, fliqName, currencies, networks(token: String), address, arriving, request
    }

    let start: Start
    let makeReceive: () -> ReceiveFlow
    let makeRequest: () -> RequestFlow
    let onAccount: (VerifiedAccount) -> Void
    let onPerson: (String?) -> Void
    let onNewAccount: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var path: [Step] = []
    @State private var receive: ReceiveFlow?
    @State private var request: RequestFlow?
    @State private var detent = PresentationDetent.large

    static let menuHeight = PresentationDetent.height(470)

    var body: some View {
        NavigationStack(path: $path) {
            root.navigationDestination(for: Step.self, destination: screen)
        }
        .tint(Theme.textPrimary)
        .presentationDetents([Self.menuHeight, .large], selection: $detent)
        .onAppear { detent = Self.menuHeight }
        .onChange(of: path) { _, path in
            withAnimation(.snappy) { detent = isChoosing(path) ? Self.menuHeight : .large }
        }
    }

    /// Grows the sheet first, then moves on, so the next screen never shows squeezed into the short sheet.
    private func go(_ step: Step) {
        guard detent != .large, !isChoosing(path + [step]) else { return path.append(step) }
        withAnimation(.snappy(duration: 0.28)) { detent = .large }
        Task {
            try? await Task.sleep(for: .milliseconds(280))
            path.append(step)
        }
    }

    /// The menu and "How do you want to get paid?" are short choices, so the sheet stays low for them.
    private func isChoosing(_ path: [Step]) -> Bool {
        path.isEmpty || path == [.receive]
    }

    @ViewBuilder
    private var root: some View {
        switch start {
        case .menu:
            MoveMoneyMenu(
                onSend: { go(.payTo) },
                onReceive: { openReceive() },
                onRequest: {
                    request = makeRequest()
                    go(.request)
                }
            )
        case .receive:
            receiveStart.task { if receive == nil { receive = makeReceive() } }
        }
    }

    private var receiveStart: some View {
        ReceiveStartView(name: receive?.name, onFliqName: { go(.fliqName) }, onWallet: { go(.currencies) })
    }

    private func openReceive() {
        if receive == nil { receive = makeReceive() }
        go(.receive)
    }

    @ViewBuilder
    private func screen(_ step: Step) -> some View {
        switch step {
        case .payTo:
            PayToView(onAccount: onAccount, onPerson: onPerson, onNew: onNewAccount)
        case .request:
            if let request { RequestView(flow: request) { dismiss() } }
        case .receive:
            receiveStart
        default:
            if let receive { receiveScreen(step, receive) }
        }
    }

    @ViewBuilder
    private func receiveScreen(_ step: Step, _ flow: ReceiveFlow) -> some View {
        switch step {
        case .fliqName: FliqNameCardView(name: flow.name ?? "")
        case .currencies:
            CurrencyListView(flow: flow) { token in
                let networks = flow.networks(for: token)
                if networks.count == 1, let only = networks.first { reserve(only, in: flow) } else { go(.networks(token: token)) }
            }
            .task { await flow.loadSources() }
        case .networks(let token): NetworkListView(flow: flow, token: token) { reserve($0, in: flow) }
        case .address: DepositAddressView(flow: flow) { if path.last != .arriving { go(.arriving) } }
        case .arriving: ArrivingView(flow: flow) { dismiss() }
        default: EmptyView()
        }
    }

    private func reserve(_ source: DepositSource, in flow: ReceiveFlow) {
        Task { if await flow.reserve(source) { go(.address) } }
    }
}

// MARK: How

private struct ReceiveStartView: View {
    let name: String?
    let onFliqName: () -> Void
    let onWallet: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            Image("IconDownload")
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .frame(width: 52, height: 52)
                .foregroundStyle(Theme.textSecondary)
                .padding(.top, 8)
            Text("How do you want to get paid?")
                .font(.system(size: 24, weight: .bold))
                .tracking(-0.4)
                .multilineTextAlignment(.center)
                .padding(.top, 18)
            VStack(spacing: 10) {
                if let name {
                    SheetRow(title: "Your fliq name", detail: "Share \(name)", action: onFliqName) {
                        NEARMark(size: 22)
                    }
                }
                SheetRow(title: "External wallet", detail: "Choose a coin and network", action: onWallet) {
                    Image(systemName: "wallet.bifold").font(.system(size: 20))
                }
            }
            .padding(.top, 34)
            Spacer()
        }
        .padding(.horizontal, 16)
        .sheetToolbar { dismiss() }
    }
}

// MARK: Currency

private struct CurrencyListView: View {
    let flow: ReceiveFlow
    let onPick: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if let message = flow.errorMessage, flow.sources.isEmpty, !flow.isLoading {
                    Callout(text: message, symbol: "wifi.exclamationmark", tint: Theme.warning).padding(.top, 8)
                    Button("Try again") { Task { await flow.loadSources() } }
                        .buttonStyle(PrimaryButtonStyle())
                        .padding(.top, 12)
                }
                if flow.isLoading && flow.sources.isEmpty {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                }
                ForEach(flow.currencies, id: \.group) { group in
                    Text(group.group.title)
                        .font(.system(size: 20))
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.top, 28)
                        .padding(.bottom, 14)
                    VStack(spacing: 10) {
                        ForEach(group.tokens, id: \.self) { token in
                            Button { onPick(token) } label: { row(token) }
                                .buttonStyle(.pressable(scale: 0.98))
                                .disabled(flow.isReserving)
                                .accessibilityIdentifier(Self.name(of: token))
                        }
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .scrollIndicators(.hidden)
        .navigationTitle("Choose currency to receive")
        .navigationBarTitleDisplayMode(.inline)
        .sheetToolbar { dismiss() }
    }

    private func row(_ token: String) -> some View {
        HStack(spacing: 18) {
            TokenLogo(token: token.uppercased(), size: 40)
            Text(Self.name(of: token)).font(.system(size: 20))
            Spacer()
            if flow.isReserving, flow.source?.tokenId == token {
                ProgressView()
            } else {
                Image(systemName: "chevron.right").font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.textSecondary)
            }
        }
        .foregroundStyle(Theme.textPrimary)
        .padding(.leading, 14)
        .padding(.trailing, 22)
        .frame(height: 56)
        .background(Color(hex: 0x222222), in: RoundedRectangle(cornerRadius: 16))
        .contentShape(Rectangle())
    }

    static func name(of token: String) -> String {
        switch token {
        case "usdc": "USDC"
        case "usdt": "Tether USDT"
        case "btc": "Bitcoin"
        default: token.uppercased()
        }
    }
}

// MARK: Network

private struct NetworkListView: View {
    let flow: ReceiveFlow
    let token: String
    let onPick: (DepositSource) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Receive \(token.uppercased())")
                            .font(.system(size: 36, weight: .medium))
                            .tracking(-0.7)
                        Text(token == "btc" ? "Lands in your vault as dollars" : "1 \(token.uppercased()) ≈ $1.00")
                            .font(.system(size: 18))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                    TokenLogo(token: token.uppercased(), size: 40)
                }
                .padding(.top, 20)

                HStack(spacing: 18) {
                    Image(systemName: "exclamationmark.circle").font(.system(size: 22)).foregroundStyle(Color(hex: 0xF5C542))
                    Text("Your receiving address depends on the coin and network.")
                        .font(.system(size: 17))
                        .foregroundStyle(Theme.textPrimary)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 22)
                .padding(.vertical, 18)
                .background(Color(hex: 0x0E0E0E), in: RoundedRectangle(cornerRadius: 22))
                .padding(.top, 26)

                let networks = flow.networks(for: token)
                VStack(spacing: 0) {
                    ForEach(Array(networks.enumerated()), id: \.element.id) { index, source in
                        Button { onPick(source) } label: { row(source) }
                            .disabled(flow.reason(unavailable: source) != nil || flow.isReserving)
                            .accessibilityIdentifier(source.chain)
                        if index < networks.count - 1 {
                            Rectangle().fill(Color(hex: 0x1A1A1A)).frame(height: 1.5)
                        }
                    }
                }
                .background(Color(hex: 0x262626), in: RoundedRectangle(cornerRadius: 26))
                .overlay(RoundedRectangle(cornerRadius: 26).strokeBorder(Color.white.opacity(0.06)))
                .padding(.top, 24)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .scrollIndicators(.hidden)
        .navigationTitle("Choose network")
        .navigationBarTitleDisplayMode(.inline)
        .sheetToolbar { dismiss() }
    }

    private func row(_ source: DepositSource) -> some View {
        let reason = flow.reason(unavailable: source)
        return HStack(spacing: 18) {
            ChainLogo(source: source, size: 32)
            VStack(alignment: .leading, spacing: 4) {
                Text(source.isDirect ? "NEAR" : source.chain).font(.system(size: 20))
                Text(reason ?? (source.isDirect ? "\(source.eta) · no fee" : source.eta))
                    .font(.system(size: 17))
                    .foregroundStyle(reason == nil ? Theme.textSecondary : Theme.warning)
                    .lineLimit(1)
            }
            Spacer()
            if flow.isReserving && flow.source == source {
                ProgressView()
            } else if reason == nil {
                Image(systemName: "chevron.right").font(.system(size: 16, weight: .medium)).foregroundStyle(Theme.textSecondary)
            }
        }
        .foregroundStyle(Theme.textPrimary)
        .opacity(reason == nil ? 1 : 0.5)
        .padding(.leading, 22)
        .padding(.trailing, 24)
        .frame(minHeight: 76)
        .contentShape(Rectangle())
    }
}

// MARK: fliq name

/// The user's fliq name as a card to share: fliq users pay it instantly, and any NEAR wallet can send USDC to it.
private struct FliqNameCardView: View {
    let name: String
    @State private var copied = false

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Your fliq name").font(.system(size: 30, weight: .bold)).tracking(-0.6)
                Text("fliq users pay it instantly, with no fee. Any NEAR wallet can send USDC to it.")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 8)

            VStack(spacing: 18) {
                QRCode(text: name, color: .white) {
                    NEARMark(size: 22).frame(width: 46, height: 46).background(Color.black, in: Circle())
                }
                .frame(width: 210, height: 210)
                Text(name)
                    .font(.system(size: 17, weight: .semibold, design: .monospaced))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            .padding(24)
            .frame(maxWidth: .infinity)
            .fliqGlass(RoundedRectangle(cornerRadius: 28))
            .padding(.top, 24)

            Spacer()

            HStack(spacing: 10) {
                Button {
                    UIPasteboard.general.string = name
                    copied = true
                } label: {
                    Label(copied ? "Copied" : "Copy name", systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                .buttonStyle(PrimaryButtonStyle(filled: true))
                ShareLink(item: name) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 18, weight: .semibold))
                        .frame(width: 56, height: 56)
                        .fliqGlass(Circle(), interactive: true)
                }
                .accessibilityLabel("Share name")
            }
            .padding(.bottom, 12)
        }
        .padding(.horizontal, 16)
        .sensoryFeedback(.success, trigger: copied)
    }
}

// MARK: Shared

/// A tall row with a mark, two lines and a chevron, as the Receive and Move money sheets use.
struct SheetRow<Mark: View>: View {
    let title: String
    let detail: String
    let action: () -> Void
    @ViewBuilder let mark: () -> Mark

    var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                mark().frame(width: 44, height: 44)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.system(size: 18, weight: .semibold))
                    Text(detail).font(.system(size: 15)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.textTertiary)
            }
            .foregroundStyle(Theme.textPrimary)
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
            .contentShape(Rectangle())
            .fliqGlass(RoundedRectangle(cornerRadius: 22), interactive: true)
        }
        .buttonStyle(.pressable(scale: 0.98))
        .accessibilityIdentifier(title)
    }
}

/// A short note in a rounded box, with an icon in its own colour.
struct Callout: View {
    let text: String
    let symbol: String
    var tint: Color = Theme.textSecondary

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol).font(.system(size: 20)).foregroundStyle(tint)
            Text(text).font(.system(size: 15)).foregroundStyle(Theme.textPrimary)
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(Color.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 20))
    }
}

/// A coin's logo, or its letters when the app ships none.
struct TokenLogo: View {
    let token: String
    var size: CGFloat = 38

    var body: some View {
        Group {
            if let image = UIImage(named: "Token\(token)") {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Text(token.prefix(2)).font(.system(size: size * 0.36, weight: .bold)).frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.surfaceRaised)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

/// A network's logo, or its first letter on a soft disc when the app ships none.
struct ChainLogo: View {
    let source: DepositSource
    var size: CGFloat = 38

    var body: some View {
        Group {
            if source.group == .bitcoin {
                TokenLogo(token: "BTC", size: size)
            } else if let image = UIImage(named: source.chainImage) {
                Image(uiImage: image).resizable().scaledToFit().background(Color(hex: 0x111111))
            } else {
                Text(source.chain.prefix(1))
                    .font(.system(size: size * 0.42, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(hex: 0x7B3FE4))
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

/// The token's coin with its network in a small ring at the bottom right, as on every Receive screen.
struct SourceBadge: View {
    let source: DepositSource
    var size: CGFloat = 38
    var ring = Color(hex: 0x1E1E1E)

    var body: some View {
        TokenLogo(token: source.token, size: size)
            .overlay(alignment: .bottomTrailing) {
                if source.group != .bitcoin {
                    ChainLogo(source: source, size: (size * 0.47).rounded())
                        .padding(2)
                        .background(ring, in: Circle())
                        .offset(x: 3, y: 3)
                }
            }
    }
}

extension View {
    /// A close button on the right of a sheet's own navigation bar.
    func sheetToolbar(onClose: @escaping () -> Void) -> some View {
        toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(action: onClose) { Image(systemName: "xmark") }
                    .accessibilityLabel("Close")
            }
        }
    }
}
