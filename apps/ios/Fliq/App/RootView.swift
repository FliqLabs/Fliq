import SwiftUI

struct RootView: View {
    @Environment(AppEnvironment.self) private var environment
    @State private var home: HomeModel?
    @State private var flow: PayFlow?

    var body: some View {
        @Bindable var router = environment.router

        NavigationStack(path: $router.path) {
            Group {
                if let home {
                    HomeView(model: home, onSend: startPayment, onActivity: { router.push(.activity) })
                }
            }
            .navigationDestination(for: AppRoute.self, destination: destination)
        }
        .tint(Theme.textPrimary)
        .onAppear {
            if home == nil { home = HomeModel(api: environment.api) }
        }
    }

    private func startPayment() {
        flow = PayFlow(api: environment.api, activity: environment.activity)
        environment.router.push(.payNew)
    }

    @ViewBuilder
    private func destination(_ route: AppRoute) -> some View {
        switch route {
        case .activity:
            ActivityView(store: environment.activity, onReceive: { environment.router.reset() })
        case .receipt(let id):
            if let payout = environment.activity.entry(id: id)?.payout {
                receipt(for: payout)
            }
        case .payNew, .payAmount, .payQuote, .paySending, .payPaid, .payRefunded:
            if let flow { payStep(route, flow) }
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
        case .activity, .receipt: EmptyView()
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
