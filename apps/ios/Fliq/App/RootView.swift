import SwiftUI

/// The sheets Home opens. Setting a new one while another shows swaps them.
enum HomeSheet: Identifiable {
    case moveMoney, payTo
    case receive(ReceiveFlow)

    var id: String {
        switch self {
        case .moveMoney: "move"
        case .payTo: "payTo"
        case .receive: "receive"
        }
    }
}

struct RootView: View {
    @Environment(AppEnvironment.self) private var environment
    @State private var home: HomeModel?
    @State private var flow: PayFlow?
    @State private var personFlow: PersonPayFlow?
    @State private var requestFlow: RequestFlow?
    @State private var sheet: HomeSheet?
    @State private var tab = HomeTab.balance

    var body: some View {
        @Bindable var router = environment.router

        NavigationStack(path: $router.path) {
            Group {
                if let home {
                    HomeView(model: home, tab: $tab, onMoveMoney: { sheet = .moveMoney }, onMenu: { router.push(.settings) }) {
                        ActivityView(store: environment.activity, onReceive: startReceive)
                    }
                }
            }
            .navigationDestination(for: AppRoute.self, destination: destination)
        }
        .tint(Theme.textPrimary)
        .sheet(item: $sheet) { sheet in
            switch sheet {
            case .moveMoney:
                MoveMoneySheet(
                    onSend: { self.sheet = .payTo },
                    onReceive: startReceive,
                    onRequest: startRequest
                )
                .presentationDetents([.height(460)])
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(32)
                .presentationBackground(Color(hex: 0x141414))
            case .payTo:
                PayToView(onAccount: { account in
                    self.sheet = nil
                    startPayment(to: account)
                }, onPerson: { account in
                    self.sheet = nil
                    startPersonPayment(to: account)
                }, onNew: {
                    self.sheet = nil
                    startPayment()
                })
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(28)
                .presentationBackground(Color(hex: 0x141414))
            case .receive(let flow):
                ReceiveSheet(flow: flow)
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
                    .presentationCornerRadius(28)
                    .presentationBackground(Color(hex: 0x141414))
            }
        }
        .onAppear {
            if home == nil { home = HomeModel(api: environment.api, vault: environment.vault) }
        }
        .task(id: router.path.isEmpty) {
            if router.path.isEmpty { await environment.refreshVault() }
        }
    }

    private func startPayment(to account: VerifiedAccount? = nil) {
        let flow = PayFlow(api: environment.api, activity: environment.activity, vault: environment.vault, accounts: environment.accounts)
        self.flow = flow
        guard let account else { return environment.router.push(.payNew) }
        flow.recipient.use(account)
        environment.router.push(.payAmount)
    }

    private func startPersonPayment(to account: String?) {
        personFlow = PersonPayFlow(api: environment.api, transfers: environment.transfers, vault: environment.vault, account: account)
        environment.router.push(.payPerson)
    }

    private func startReceive() {
        sheet = .receive(ReceiveFlow(
            api: environment.deposits,
            vault: environment.vault,
            vaultAccount: environment.profile.name ?? "fliq-vault.testnet",
            name: environment.profile.name
        ))
    }

    private func startRequest() {
        sheet = nil
        requestFlow = RequestFlow(api: environment.api, vault: environment.vault)
        environment.router.push(.request)
    }

    @ViewBuilder
    private func destination(_ route: AppRoute) -> some View {
        switch route {
        case .receipt(let id):
            if let payout = environment.activity.entry(id: id)?.payout {
                receipt(for: payout)
            }
        case .payNew, .payAmount, .payQuote, .paySending, .payPaid, .payRefunded:
            if let flow { payStep(route, flow) }
        case .payPerson:
            if let personFlow {
                PersonPayView(flow: personFlow) {
                    environment.router.reset()
                    Task { await environment.refreshVault() }
                }
            }
        case .request:
            if let requestFlow {
                RequestView(flow: requestFlow) { environment.router.reset() }
            }
        case .agents: AgentsView(store: environment.agents)
        case .settings: SettingsView()
        case .settingsAccounts: AccountsView(onAdd: { startPayment() })
        case .settingsSecurity: SecurityView()
        case .settingsNotifications: NotificationsView()
        case .agentConnect: AgentConnectView(store: environment.agents)
        }
    }

    @ViewBuilder
    private func payStep(_ route: AppRoute, _ flow: PayFlow) -> some View {
        switch route {
        case .payNew: NewAccountView(flow: flow)
        case .payAmount: AmountView(flow: flow)
        case .payQuote: QuoteView(flow: flow)
        case .paySending: SendingView(flow: flow)
        case .payPaid:
            if let payout = flow.payout { PaidView(payout: payout, onPayAgain: { startPayment(to: flow.verified) }) }
        case .payRefunded:
            if let payout = flow.payout {
                RefundedView(payout: payout, quote: flow.quote, onTryAgain: { startPayment(to: flow.verified) })
            }
        case .payPerson, .request, .receipt, .agents, .agentConnect, .settings, .settingsAccounts, .settingsSecurity, .settingsNotifications: EmptyView()
        }
    }


    @ViewBuilder
    private func receipt(for payout: Payout) -> some View {
        switch payout.state {
        case .refunded: RefundedView(payout: payout)
        case .settled: PaidView(payout: payout)
        default: SendingReceipt(payout: payout)
        }
    }
}

/// A payout from Activity that is still moving or did not settle.
private struct SendingReceipt: View {
    let payout: Payout

    var body: some View {
        VStack(spacing: 8) {
            HeroAmount(symbol: payout.currency.symbol, value: payout.receive.formatted())
            Text("to \(payout.accountName) · \(payout.state.rawValue.replacingOccurrences(of: "_", with: " "))")
                .font(.system(size: 15))
                .foregroundStyle(Theme.textSecondary)
        }
        .padding(.top, 60)
        .fliqScreen("Payout")
    }
}
