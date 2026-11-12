import SwiftUI
import UIKit

/// Transfer as one sheet: every step slides in place, nothing closes and reopens. Short choices keep the card
/// short; full screens open full height and can be dragged down to half, where they still scroll.
struct MoveMoneySheet: View {
    enum Step: Hashable {
        case receive, request, payTo, fliqName, currencies, networks(token: String), address, arriving
        case recipientCurrency, sendMethod(Country), recipient(Country, SendMethod)
    }

    static let menuHeight = PresentationDetent.height(470)
    /// Amount, note, cash-out switch and button, sitting above the decimal pad with nothing cut off.
    static let requestHeight = PresentationDetent.large

    let name: String?
    let receive: ReceiveFlow
    var inbox: WalletInbox?
    let makeRequest: () -> RequestFlow
    let onAccount: (VerifiedAccount) -> Void
    let onPerson: (String?) -> Void
    let onNewAccount: (VerifiedAccount, Bool) -> Void
    var onWallet: (() -> Void)?
    var onBankDeposit: (() -> Void)?
    @Environment(\.dismiss) private var dismiss
    @Environment(AppEnvironment.self) private var environment
    @State private var path: [Step]
    @State private var request: RequestFlow?
    @State private var detent: PresentationDetent
    @State private var scan: ScanToPayModel?
    @State private var afterScan: (() -> Void)?

    init(
        startingAt start: [Step] = [],
        name: String?,
        receive: ReceiveFlow,
        inbox: WalletInbox? = nil,
        makeRequest: @escaping () -> RequestFlow,
        onAccount: @escaping (VerifiedAccount) -> Void,
        onPerson: @escaping (String?) -> Void,
        onNewAccount: @escaping (VerifiedAccount, Bool) -> Void,
        onWallet: (() -> Void)? = nil,
        onBankDeposit: (() -> Void)? = nil
    ) {
        self.name = name
        self.receive = receive
        self.inbox = inbox
        self.makeRequest = makeRequest
        self.onAccount = onAccount
        self.onPerson = onPerson
        self.onNewAccount = onNewAccount
        self.onWallet = onWallet
        self.onBankDeposit = onBankDeposit
        _path = State(initialValue: start)
        _detent = State(initialValue: Self.menuHeight)
    }

    var body: some View {
        NavigationStack(path: $path) {
            MoveMoneyMenu(onSend: { go(.payTo) }, onReceive: { go(.receive) }, onRequest: { go(.request) }, onScan: startScan)
                .navigationDestination(for: Step.self, destination: screen)
        }
        .fullScreenCover(item: $scan, onDismiss: { afterScan?(); afterScan = nil }) { scanner($0) }
        .tint(Theme.textPrimary)
        .presentationDetents(Self.detents(for: path.last).union([detent]), selection: $detent)
        .onChange(of: path) { _, path in
            let allowed = Self.detents(for: path.last)
            if !allowed.contains(detent) { withAnimation(.snappy) { detent = Self.opening(path.last) } }
        }
    }

    @ViewBuilder
    private func screen(_ step: Step) -> some View {
        switch step {
        case .receive:
            ReceiveStartView(name: name, flow: receive, onFliqName: { go(.fliqName) }, onWallet: openWallet, onBankDeposit: onBankDeposit)
                .task { await receive.loadSources() }
        case .request:
            if let request { RequestView(flow: request) { dismiss() }.sheetToolbar { dismiss() } }
        case .payTo:
            PayToView(onAccount: onAccount, onPerson: onPerson, onNew: { go(.recipientCurrency) }, onScan: startScan, onWallet: onWallet)
        case .recipientCurrency:
            RecipientCurrencyView { go(.sendMethod($0)) }
        case .sendMethod(let country):
            SendMethodView(country: country) { method in
                if method == .fliqName { onPerson(nil) } else { go(.recipient(country, method)) }
            }
        case .recipient(let country, let method):
            RecipientFormView(country: country, method: method, onContinue: onNewAccount)
        case .fliqName:
            FliqNameCardView(name: name ?? "", inbox: inbox).sheetToolbar { dismiss() }
        case .currencies:
            CurrencyListView(flow: receive) { token in
                let networks = receive.choices(for: token)
                if networks.count == 1, let only = networks.first, receive.reason(unavailable: only) == nil {
                    reserve(only)
                } else {
                    go(.networks(token: token))
                }
            }
            .task { await receive.loadSources() }
        case .networks(let token):
            NetworkListView(flow: receive, token: token, onPick: reserve)
        case .address:
            DepositAddressView(flow: receive) { if path.last != .arriving { go(.arriving) } }
        case .arriving:
            ArrivingView(flow: receive) { dismiss() }
        }
    }

    /// The camera closes first; whatever was scanned carries on once it's gone.
    private func scanner(_ model: ScanToPayModel) -> some View {
        ScanToPayView(
            model: model,
            onPay: { account in finishScan { onNewAccount(account, false) } },
            onPerson: { name in finishScan { onPerson(name) } },
            onTypeInstead: { finishScan { go(.recipient(.ng, .bank)) } }
        )
    }

    private func startScan() {
        scan = ScanToPayModel(api: environment.api)
    }

    private func finishScan(then next: @escaping () -> Void) {
        afterScan = next
        scan = nil
    }

    /// Moves on. A step that needs more room grows the sheet first, so it never appears squeezed.
    private func go(_ step: Step) {
        if step == .request, request == nil { request = makeRequest() }
        let target = Self.opening(step)
        guard target != detent else { return path.append(step) }
        withAnimation(.snappy(duration: 0.28)) { detent = target }
        Task {
            try? await Task.sleep(for: .milliseconds(280))
            path.append(step)
        }
    }

    private func reserve(_ source: DepositSource) {
        Task { if await receive.reserve(source) { go(.address) } }
    }

    /// With a single way to receive, as on testnet, both pickers are skipped and the address opens straight away.
    private func openWallet() {
        guard let only = receive.onlyOption else { return go(.currencies) }
        Task {
            if await receive.reserve(only) { go(.address) } else { go(.currencies) }
        }
    }

    private static func detents(for step: Step?) -> Set<PresentationDetent> {
        switch step {
        case nil, .receive: [menuHeight]
        case .request: [requestHeight]
        default: [.medium, .large]
        }
    }

    private static func opening(_ step: Step?) -> PresentationDetent {
        switch step {
        case nil, .receive: menuHeight
        case .request: requestHeight
        case .currencies: .medium
        default: .large
        }
    }
}

// MARK: How

private struct ReceiveStartView: View {
    let name: String?
    let flow: ReceiveFlow
    let onFliqName: () -> Void
    let onWallet: () -> Void
    var onBankDeposit: (() -> Void)?
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
                if let onBankDeposit {
                    SheetRow(title: "Bank transfer", detail: "Pay in naira from any Nigerian bank", action: onBankDeposit) {
                        Icon("building.columns", size: 24)
                    }
                }
                if let name {
                    SheetRow(title: "Your fliq name", detail: "Share \(name)", action: onFliqName) {
                        NEARMark(size: 22)
                    }
                }
                SheetRow(title: "External wallet", detail: flow.onlyOption?.title ?? "Choose a coin and network", action: onWallet) {
                    if flow.isReserving {
                        ProgressView()
                    } else {
                        Icon("wallet.bifold", size: 24)
                    }
                }
                .disabled(flow.isReserving)
            }
            .padding(.top, 34)
            TestNetworkNote(network: flow.network).padding(.top, 14)
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
                if let notice = flow.notice {
                    Text(notice).font(.system(size: 13)).foregroundStyle(Theme.warning).padding(.top, 12)
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
                                .disabled(flow.isReserving || flow.networks(for: token).isEmpty)
                                .accessibilityIdentifier(Self.name(of: token))
                        }
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 16)
            TestNetworkNote(network: flow.network).padding(.horizontal, 24).padding(.bottom, 24)
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
            } else if flow.networks(for: token).isEmpty {
                Text("Coming soon").font(.system(size: 15)).foregroundStyle(Theme.textSecondary)
            } else {
                Icon("chevron.right", size: 18).foregroundStyle(Theme.textSecondary)
            }
        }
        .foregroundStyle(Theme.textPrimary)
        .opacity(flow.networks(for: token).isEmpty ? 0.5 : 1)
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
    /// At half height the header and rows tighten so every network still fits without scrolling.
    @State private var compact = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Receive \(token.uppercased())")
                            .font(.system(size: compact ? 26 : 36, weight: .medium))
                            .tracking(-0.7)
                        Text(token == "btc" ? "Lands in your vault as dollars" : "1 \(token.uppercased()) ≈ $1.00")
                            .font(.system(size: compact ? 15 : 18))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                    TokenLogo(token: token.uppercased(), size: compact ? 32 : 40)
                }
                .padding(.top, compact ? 8 : 20)

                if !compact {
                    HStack(spacing: 18) {
                        Icon("exclamationmark.circle", size: 26).foregroundStyle(Color(hex: 0xF5C542))
                        Text("Your receiving address depends on the coin and network.")
                            .font(.system(size: 17))
                            .foregroundStyle(Theme.textPrimary)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 22)
                    .padding(.vertical, 18)
                    .background(Color(hex: 0x0E0E0E), in: RoundedRectangle(cornerRadius: 22))
                    .padding(.top, 26)
                }

                let networks = flow.choices(for: token)
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
                .padding(.top, compact ? 14 : 24)
                if let notice = flow.notice {
                    Text(notice).font(.system(size: 13)).foregroundStyle(Theme.warning).padding(.top, 12)
                }
                TestNetworkNote(network: flow.network).padding(.top, 14)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .scrollIndicators(.hidden)
        .onGeometryChange(for: Bool.self) { $0.size.height < 560 } action: { small in
            withAnimation(.snappy(duration: 0.2)) { compact = small }
        }
        .navigationTitle("Choose network")
        .navigationBarTitleDisplayMode(.inline)
        .sheetToolbar { dismiss() }
    }

    private func row(_ source: DepositSource) -> some View {
        let reason = flow.reason(unavailable: source)
        return HStack(spacing: 18) {
            ChainLogo(source: source, size: compact ? 28 : 32)
            VStack(alignment: .leading, spacing: compact ? 2 : 4) {
                Text(source.isDirect ? "NEAR" : source.chain).font(.system(size: compact ? 17 : 20))
                Text(reason == nil ? (source.isDirect ? "\(source.eta) · no fee" : source.eta) : "Coming soon")
                    .font(.system(size: compact ? 14 : 17))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }
            Spacer()
            if flow.isReserving && flow.source == source {
                ProgressView()
            } else if reason == nil {
                Icon("chevron.right", size: 19).foregroundStyle(Theme.textSecondary)
            }
        }
        .foregroundStyle(Theme.textPrimary)
        .opacity(reason == nil ? 1 : 0.5)
        .padding(.leading, 22)
        .padding(.trailing, 24)
        .frame(minHeight: compact ? 56 : 76)
        .accessibilityHint(reason ?? "")
        .contentShape(Rectangle())
    }
}

// MARK: fliq name

/// The user's fliq name as a card to share: fliq users pay it instantly, and any NEAR wallet can send USDC to it.
struct FliqNameCardView: View {
    let name: String
    var inbox: WalletInbox?
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
                VStack(spacing: 4) {
                    Text(FliqName.display(name))
                        .font(.system(size: 24, weight: .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text("NEAR wallets: \(name)")
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(Theme.textTertiary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .textSelection(.enabled)
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity)
            .fliqGlass(RoundedRectangle(cornerRadius: 28))
            .padding(.top, 24)

            Spacer()

            if let inbox { WalletArrivedCard(inbox: inbox).padding(.bottom, 12) }

            HStack(spacing: 10) {
                Button {
                    UIPasteboard.general.string = name
                    copied = true
                } label: {
                    IconLabel(copied ? "Copied" : "Copy NEAR address", icon: copied ? "checkmark" : "doc.on.doc")
                }
                .buttonStyle(PrimaryButtonStyle(filled: true))
                ShareLink(item: "Pay me on fliq: \(FliqName.display(name))\nFrom a NEAR wallet, send USDC to \(name)") {
                    Icon("square.and.arrow.up", size: 22)
                        .frame(width: 56, height: 56)
                        .fliqGlass(Circle(), interactive: true)
                }
                .accessibilityLabel("Share name")
            }
            .padding(.bottom, 12)
        }
        .padding(.horizontal, 16)
        .sensoryFeedback(.success, trigger: copied)
        .task { await watch() }
    }

    /// Money sent to the name shows up here while the screen is open, so it can be added straight away.
    private func watch() async {
        guard let inbox else { return }
        while !Task.isCancelled {
            await inbox.load()
            try? await Task.sleep(for: .seconds(5))
        }
    }
}

// MARK: Shared

/// A tall row with a mark, two lines and a chevron, as the Receive and Move money sheets use.
/// On testnet, one quiet line on why only NEAR is offered. Nothing on mainnet.
struct TestNetworkNote: View {
    let network: NearNetwork

    var body: some View {
        if !network.receivesFromOtherChains {
            Text("Test network: receiving from other chains turns on with mainnet")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textTertiary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
        }
    }
}

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
                Icon("chevron.right", size: 18)
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
            Icon(symbol, size: 24).foregroundStyle(tint)
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
                Button(action: onClose) { Icon("xmark") }
                    .accessibilityLabel("Close")
            }
        }
    }
}
