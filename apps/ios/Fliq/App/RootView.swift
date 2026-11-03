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
                    HomeView(model: home, onSend: startPayment)
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
        flow = PayFlow(api: environment.api)
        environment.router.push(.payNew)
    }

    @ViewBuilder
    private func destination(_ route: AppRoute) -> some View {
        if let flow {
            switch route {
            case .payNew: NewAccountView(flow: flow)
            case .payAmount: AmountView(flow: flow)
            case .payQuote: QuoteView(flow: flow)
            case .paySending: SendingView(flow: flow)
            case .payPaid: PaidView(flow: flow, onPayAgain: startPayment)
            }
        }
    }
}
