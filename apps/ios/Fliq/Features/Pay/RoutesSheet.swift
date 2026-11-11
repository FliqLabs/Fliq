import SwiftUI

/// Every provider asked for this quote, sorted by what lands after fees.
struct RoutesSheet: View {
    let quote: Quote
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 10) {
            HStack {
                Spacer().frame(width: 32)
                Spacer()
                Text("Routes for $\(quote.amount.decimalString)").font(.system(size: 17, weight: .semibold))
                Spacer()
                Button { dismiss() } label: { Icon("xmark") }
                    .frame(width: 32, height: 32)
                    .accessibilityLabel("Close")
            }
            .padding(.top, 20)
            Text("Sorted by what lands after every fee")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
                .padding(.bottom, 6)

            ForEach(sorted, id: \.provider) { route in
                RouteRow(route: route, quote: quote, best: best)
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .foregroundStyle(Theme.textPrimary)
    }

    private var best: Int { quote.receive }

    private var sorted: [Route] {
        quote.routes.sorted { lands($0) > lands($1) }
    }

    private func lands(_ route: Route) -> Int {
        if route.routed == true { return quote.receive }
        return route.rate.map { Money.estimate(quote.amount, at: $0) } ?? -1
    }
}

private struct RouteRow: View {
    let route: Route
    let quote: Quote
    let best: Int

    var body: some View {
        HStack(spacing: 14) {
            ProviderMark(provider: route.provider, size: 38)
            VStack(alignment: .leading, spacing: 3) {
                Text(route.provider.displayName).font(.system(size: 16, weight: .medium))
                Text(detail).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            trailing
        }
        .padding(.horizontal, 16)
        .frame(height: 70)
        .background(Color(hex: 0x1E1E1E), in: RoundedRectangle(cornerRadius: 14))
        .overlay {
            if route.routed == true {
                RoundedRectangle(cornerRadius: 14).strokeBorder(.white)
            }
        }
        .opacity(route.status == .paused ? 0.45 : 1)
        .accessibilityElement(children: .combine)
    }

    private var lands: Int? {
        if route.routed == true { return quote.receive }
        return route.rate.map { Money.estimate(quote.amount, at: $0) }
    }

    private var detail: String {
        switch route.status {
        case .live: route.ageSeconds.map { "Live · quoted \($0)s ago" } ?? "Live"
        case .stale: route.ageSeconds.map { "Stale · last quote \($0 / 60) min ago" } ?? "Stale"
        case .paused: "Paused"
        }
    }

    @ViewBuilder
    private var trailing: some View {
        if let lands, route.status != .paused {
            VStack(alignment: .trailing, spacing: 3) {
                Text(Money.local(lands, quote.currency))
                    .font(.system(size: 16, weight: .medium).monospacedDigit())
                if route.routed == true {
                    Text("Best").font(.system(size: 12)).foregroundStyle(Theme.confirmed)
                } else {
                    Text("\(Money.local(best - lands, quote.currency)) less")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textTertiary)
                }
            }
        } else {
            Text("Not offered").font(.system(size: 13)).foregroundStyle(Theme.textTertiary)
        }
    }
}
