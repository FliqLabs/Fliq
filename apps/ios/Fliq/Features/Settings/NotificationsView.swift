import SwiftUI

struct NotificationsView: View {
    @Environment(AppEnvironment.self) private var environment
    @State private var rateText = ""
    @FocusState private var rateFocused: Bool

    private let groups: [(String, [Preferences.Notice])] = [
        ("Money", [.received, .payoutPaid, .payoutRefunded]),
        ("Agents", [.agentPaid, .agentRefused, .capAlmostReached]),
        ("Rates", [.rateAlert, .weeklySummary]),
    ]

    private var preferences: Preferences { environment.preferences }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                ForEach(groups, id: \.0) { title, notices in
                    SectionLabel(text: title).padding(.top, 20)
                    VStack(spacing: 0) {
                        ForEach(notices, id: \.self) { notice in
                            CardRow(isLast: notice == notices.last && !showsRateField(after: notice)) {
                                Toggle(isOn: binding(notice)) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(notice.title)
                                        if let detail = detail(notice) {
                                            Text(detail).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                                        }
                                    }
                                }
                                .tint(Theme.confirmed)
                            }
                            if showsRateField(after: notice) { rateRow }
                        }
                    }
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
                    .foregroundStyle(Theme.textPrimary)
                }
                Text("Saved to your fliq account, so they follow you to a new phone.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
                    .padding(.top, 12)
            }
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.immediately)
        .fliqScreen("Notifications")
        .onAppear { rateText = preferences.rateAbove.map(Preferences.whole) ?? "" }
        .onChange(of: rateFocused) { _, focused in if !focused { saveRate() } }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { rateFocused = false }
            }
        }
    }

    private var rateRow: some View {
        CardRow(isLast: true) {
            HStack {
                Text("Alert me above")
                Spacer()
                Menu {
                    ForEach(Currency.allCases, id: \.self) { currency in
                        Button(currency.symbol) {
                            // ₦1,460 means nothing in shillings, so a new currency starts from its own rate.
                            if currency != preferences.rateCurrency { Task { await suggestRate(in: currency) } }
                        }
                    }
                } label: {
                    Text(preferences.rateCurrency.symbol).foregroundStyle(Theme.textSecondary)
                }
                TextField("1,500", text: $rateText)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .focused($rateFocused)
                    .frame(maxWidth: 110)
                    .accessibilityLabel("Rate to alert above")
            }
        }
    }

    private func showsRateField(after notice: Preferences.Notice) -> Bool {
        notice == .rateAlert && preferences.isOn(.rateAlert)
    }

    private func detail(_ notice: Preferences.Notice) -> String? {
        notice == .rateAlert ? preferences.rateDetail ?? "Pick a rate below" : notice.detail
    }

    private func binding(_ notice: Preferences.Notice) -> Binding<Bool> {
        Binding(
            get: { preferences.isOn(notice) },
            set: { on in
                preferences.set(notice, on)
                if notice == .rateAlert, on, preferences.rateAbove == nil { Task { await suggestRate() } }
            }
        )
    }

    private func saveRate() {
        let digits = rateText.filter(\.isNumber)
        guard let value = Double(digits), value > 0 else {
            rateText = preferences.rateAbove.map(Preferences.whole) ?? ""
            return
        }
        preferences.setRate(above: value, in: preferences.rateCurrency)
        rateText = Preferences.whole(value)
    }

    /// Starts just above today's rate, so the first alert means the rate got better.
    private func suggestRate(in currency: Currency? = nil) async {
        let currency = currency ?? preferences.rateCurrency
        let today = try? await environment.api.rate(.usdc, currency).rate
        let suggestion = today.map { RateSuggestion.above($0) } ?? RateSuggestion.fallback(currency)
        preferences.setRate(above: suggestion, in: currency)
        rateText = Preferences.whole(suggestion)
    }
}

enum RateSuggestion {
    /// The next round ten above today's rate: ₦1,452.30 suggests ₦1,460.
    static func above(_ rate: Double) -> Double { (rate / 10).rounded(.down) * 10 + 10 }

    static func fallback(_ currency: Currency) -> Double {
        switch currency {
        case .ngn: 1_500
        case .kes: 135
        }
    }
}
