import SwiftUI

struct RootView: View {
    @Environment(AppEnvironment.self) private var environment
    @State private var home: HomeModel?
    @State private var flow: PayFlow?
    @State private var personFlow: PersonPayFlow?
    @State private var tab = RootTab.home
    @State private var isMenuOpen = false
    @State private var moneySheet: MoneyAction?

    var body: some View {
        @Bindable var router = environment.router

        NavigationStack(path: $router.path) {
            ZStack(alignment: .bottom) {
                Group {
                    switch tab {
                    case .home:
                        if let home { HomeView(model: home, onMenu: { tab = .settings }) }
                    case .activity:
                        ActivityView(store: environment.activity) { moneySheet = .receive }
                            .padding(.horizontal, 16)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                            .background(Theme.ground.ignoresSafeArea())
                    case .settings:
                        SettingsView()
                    }
                }
                .safeAreaPadding(.bottom, 84)

                if isMenuOpen {
                    MoneyMenu(isOpen: $isMenuOpen) { action in moneySheet = action }
                        .transition(.opacity)
                }

                HomeBar(tab: $tab, isMenuOpen: $isMenuOpen)
                    .padding(.bottom, 8)
            }
            .toolbar(tab == .settings ? .visible : .hidden, for: .navigationBar)
            .navigationDestination(for: AppRoute.self, destination: destination)
        }
        .tint(Theme.textPrimary)
        .sheet(item: $moneySheet) { action in
            MoneySheet(
                start: action,
                makeReceive: makeReceive,
                makeRequest: { RequestFlow(api: environment.api, vault: environment.vault) },
                onAccount: { account in leaveSheet { startPayment(to: account) } },
                onPerson: { account in leaveSheet { startPersonPayment(to: account) } },
                onNewAccount: { leaveSheet { startPayment() } }
            )
            .presentationDragIndicator(.visible)
            .presentationCornerRadius(36)
            .presentationBackground(Color(hex: 0x161616))
        }
        .onAppear {
            if home == nil { home = HomeModel(api: environment.api, vault: environment.vault) }
        }
        .task(id: router.path.isEmpty) {
            if router.path.isEmpty { await environment.refreshVault() }
        }
    }

    private func leaveSheet(then next: @escaping () -> Void) {
        moneySheet = nil
        next()
    }

    private func makeReceive() -> ReceiveFlow {
        ReceiveFlow(
            api: environment.deposits,
            vault: environment.vault,
            vaultAccount: environment.profile.name ?? "fliq-vault.testnet",
            name: environment.profile.name
        )
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
        case .payPerson, .receipt, .agents, .agentConnect, .settings, .settingsAccounts, .settingsSecurity, .settingsNotifications: EmptyView()
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

