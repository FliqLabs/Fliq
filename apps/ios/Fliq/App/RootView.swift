import SwiftUI

struct RootView: View {
    @Environment(AppEnvironment.self) private var environment
    @State private var home: HomeModel?
    @State private var flow: PayFlow?
    @State private var receive: ReceiveFlow?

    var body: some View {
        @Bindable var router = environment.router

        NavigationStack(path: $router.path) {
            Group {
                if let home {
                    HomeView(model: home, onSend: startPayment, onActivity: { router.push(.activity) }, onReceive: startReceive, onMenu: { router.push(.settings) })
                }
            }
            .navigationDestination(for: AppRoute.self, destination: destination)
        }
        .tint(Theme.textPrimary)
        .onAppear {
            if home == nil { home = HomeModel(api: environment.api, vault: environment.vault) }
        }
    }

    private func startPayment() {
        flow = PayFlow(api: environment.api, activity: environment.activity, vault: environment.vault, accounts: environment.accounts)
        environment.router.push(.payNew)
    }

    private func startReceive() {
        receive = ReceiveFlow(
            api: environment.deposits,
            vault: environment.vault,
            vaultAccount: environment.profile.name ?? "fliq-vault.testnet"
        )
        environment.router.replace(with: .receiveSource)
    }

    @ViewBuilder
    private func destination(_ route: AppRoute) -> some View {
        switch route {
        case .activity:
            ActivityView(store: environment.activity, onReceive: startReceive)
        case .receipt(let id):
            if let payout = environment.activity.entry(id: id)?.payout {
                receipt(for: payout)
            }
        case .payNew, .payAmount, .payQuote, .paySending, .payPaid, .payRefunded:
            if let flow { payStep(route, flow) }
        case .receiveSource, .receiveAmount, .receiveAddress, .receiveArriving:
            if let receive { receiveStep(route, receive) }
        case .agents: AgentsView(store: environment.agents)
        case .settings: SettingsView()
        case .settingsAccounts: AccountsView(onAdd: startPayment)
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
            if let payout = flow.payout { PaidView(payout: payout, onPayAgain: startPayment) }
        case .payRefunded:
            if let payout = flow.payout {
                RefundedView(payout: payout, quote: flow.quote, onTryAgain: startPayment)
            }
        case .activity, .receipt, .receiveSource, .receiveAmount, .receiveAddress, .receiveArriving, .agents, .agentConnect, .settings, .settingsAccounts, .settingsSecurity, .settingsNotifications: EmptyView()
        }
    }

    @ViewBuilder
    private func receiveStep(_ route: AppRoute, _ receive: ReceiveFlow) -> some View {
        switch route {
        case .receiveSource: ReceiveSourceView(flow: receive)
        case .receiveAmount: ReceiveAmountView(flow: receive)
        case .receiveAddress: DepositAddressView(flow: receive)
        case .receiveArriving: ArrivingView(flow: receive)
        default: EmptyView()
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
