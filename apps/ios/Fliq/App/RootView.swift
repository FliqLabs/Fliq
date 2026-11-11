import SwiftUI

enum RootTab: Hashable {
    case home, transfer, activity
}

/// Transfer opens on its menu; Receive from Activity opens straight on "How do you want to get paid?".
enum HomeSheet: Identifiable {
    case menu, receive, qr

    var id: Self { self }
}

struct RootView: View {
    @Environment(AppEnvironment.self) private var environment
    @State private var home: HomeModel?
    @State private var flow: PayFlow?
    @State private var personFlow: PersonPayFlow?
    @State private var withdrawFlow: WithdrawFlow?
    @State private var tab = RootTab.home
    @State private var sheet: HomeSheet?
    @State private var activityPath: [AppRoute] = []

    var body: some View {
        @Bindable var router = environment.router

        TabView(selection: tabSelection) {
            NavigationStack(path: $router.path) {
                Group {
                    if let home { HomeView(model: home, onMenu: { router.push(.settings) }, onQR: { sheet = .qr }) }
                }
                .navigationDestination(for: AppRoute.self) { pushed($0) }
            }
            .tabItem { Label("Home", systemImage: "house.fill") }
            .tag(RootTab.home)

            // An action, not a page: picking it opens the money sheet and leaves the current tab selected.
            Color.clear
                .tabItem { Label("Transfer", systemImage: "arrow.up.arrow.down") }
                .tag(RootTab.transfer)

            NavigationStack(path: $activityPath) {
                ActivityView(store: environment.activity) { sheet = .receive }
                    .padding(.horizontal, 16)
                    .background(Theme.ground.ignoresSafeArea())
                    .navigationDestination(for: AppRoute.self) { pushed($0) }
            }
            .tabItem { Label("Activity", systemImage: "clock.arrow.circlepath") }
            .tag(RootTab.activity)
        }
        .tint(Theme.textPrimary)
        .minimizesTabBarOnScroll()
        .sheet(item: $sheet) { sheet in
            content(of: sheet)
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(32)
                .presentationBackground(Color(hex: 0x161616))
        }
        .onAppear {
            if home == nil { home = HomeModel(api: environment.api, vault: environment.vault, inbox: environment.inbox) }
        }
        .task(id: router.path.isEmpty) {
            guard router.path.isEmpty else { return }
            await environment.refreshVault()
            await environment.inbox.load()
        }
    }

    /// Transfer opens the money sheet without ever becoming the selected tab. Selecting it and flipping back left
    /// the Home stack with no safe area, so screens pushed from the sheet drew under the status bar.
    private var tabSelection: Binding<RootTab> {
        Binding(
            get: { tab },
            set: { picked in
                if picked == .transfer { sheet = .menu } else { tab = picked }
            }
        )
    }

    /// Pushed screens own the whole display, so the tab bar steps aside for them.
    private func pushed(_ route: AppRoute) -> some View {
        destination(route).toolbar(.hidden, for: .tabBar)
    }

    @ViewBuilder
    private func content(of sheet: HomeSheet) -> some View {
        if sheet == .qr {
            ReceiveTokensView(
                model: ReceiveTokensModel(flow: makeReceive()),
                inbox: environment.inbox,
                name: environment.profile.name
            ) { self.sheet = nil }
            .presentationDetents([.large])
        } else {
            moveMoney(sheet)
        }
    }

    private func moveMoney(_ sheet: HomeSheet) -> some View {
        MoveMoneySheet(
            startingAt: sheet == .receive ? [.receive] : [],
            name: environment.profile.name,
            receive: makeReceive(),
            inbox: environment.inbox,
            makeRequest: { RequestFlow(api: environment.api, vault: environment.vault) },
            onAccount: { account in leaveSheet { startPayment(to: account) } },
            onPerson: { account in leaveSheet { startPersonPayment(to: account) } },
            onNewAccount: { account, save in leaveSheet { startPayment(to: account, save: save) } },
            onWallet: { leaveSheet { startWithdraw() } }
        )
    }

    private func leaveSheet(then next: @escaping () -> Void) {
        sheet = nil
        tab = .home
        next()
    }

    private func makeReceive() -> ReceiveFlow {
        ReceiveFlow(
            api: environment.deposits,
            vault: environment.vault,
            vaultAccount: environment.profile.name ?? "fliq-vault.testnet",
            name: environment.profile.name,
            network: environment.isLive ? .current : .mainnet
        )
    }

    private func startPayment(to account: VerifiedAccount? = nil, save: Bool = true) {
        let flow = PayFlow(api: environment.api, activity: environment.activity, vault: environment.vault, accounts: environment.accounts)
        flow.saveAccount = save
        self.flow = flow
        guard let account else { return environment.router.push(.payNew) }
        flow.recipient.use(account)
        environment.router.push(.payAmount)
    }

    private func startPersonPayment(to account: String?) {
        personFlow = PersonPayFlow(api: environment.api, transfers: environment.transfers, vault: environment.vault, account: account)
        environment.router.push(.payPerson)
    }

    private func startWithdraw() {
        withdrawFlow = WithdrawFlow(
            withdrawals: environment.withdrawals,
            vault: environment.vault,
            network: environment.isLive ? .current : .testnet,
            onLeftVault: {
                await environment.refreshVault()
                await environment.inbox.load()
            }
        )
        environment.router.push(.withdraw)
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
        case .withdraw, .withdrawTo, .withdrawReview:
            if let withdrawFlow { withdrawStep(route, withdrawFlow) }
        case .agents: AgentsView(store: environment.agents)
        case .settings: SettingsView()
        case .settingsAccounts: AccountsView(onAdd: { startPayment() })
        case .settingsSecurity: SecurityView()
        case .settingsNotifications: NotificationsView()
        case .agentConnect: AgentConnectView(store: environment.agents)
        }
    }

    @ViewBuilder
    private func withdrawStep(_ route: AppRoute, _ flow: WithdrawFlow) -> some View {
        switch route {
        case .withdrawTo: WithdrawToView(flow: flow)
        case .withdrawReview: WithdrawReviewView(flow: flow) { environment.router.reset() }
        default: WithdrawAmountView(flow: flow)
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
        case .payPerson, .withdraw, .withdrawTo, .withdrawReview, .receipt, .agents, .agentConnect, .settings, .settingsAccounts, .settingsSecurity, .settingsNotifications: EmptyView()
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

private extension View {
    /// The iOS 26 tab bar shrinks while a list scrolls down, as Apple's own apps do.
    @ViewBuilder
    func minimizesTabBarOnScroll() -> some View {
        if #available(iOS 26.0, *) {
            tabBarMinimizeBehavior(.onScrollDown)
        } else {
            self
        }
    }
}
