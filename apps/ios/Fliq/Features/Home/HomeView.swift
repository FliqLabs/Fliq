import SwiftUI

struct HomeView: View {
    @State var model: HomeModel
    var onMenu: () -> Void = {}
    var onQR: () -> Void = {}
    var onRefresh: () async -> Void = {}
    var activity: ActivityStore?
    var onSeeAll: () -> Void = {}
    var onOpenPayout: (String) -> Void = { _ in }
    @State private var selected: ActivityLine?
    /// Remembered on this iPhone, so the balance stays hidden after the app is closed.
    @AppStorage("home.hidesBalance") private var hidesBalance = false
    /// Dollars, or a local currency at the live payout rate. Remembered on this iPhone.
    @AppStorage(DisplayCurrency.storageKey) private var shown: DisplayCurrency = .usd

    private var isMoving: Bool { activity?.lines.contains { $0.outcome == .moving } ?? false }

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    header
                    Spacer()
                    balance
                    Spacer()
                    VStack(spacing: 12) {
                        // Money on its way gets its own live card, so Recent shows what has finished.
                        let lines = activity?.lines ?? []
                        let finished = lines.filter { $0.outcome != .moving }.prefix(2)
                        if !finished.isEmpty {
                            HomeRecentCard(lines: Array(finished), onSeeAll: onSeeAll) { selected = $0 }
                        }
                        ForEach(lines.filter { $0.outcome == .moving }.prefix(2)) { line in
                            HomeInProgressCard(line: line) { selected = $0 }
                                .transition(.move(edge: .bottom).combined(with: .opacity))
                        }
                        RefundCard(inbox: model.inbox)
                        WalletArrivedCard(inbox: model.inbox)
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 64)
                    .animation(.smooth(duration: 0.3), value: activity?.rows)
                }
                .frame(minHeight: proxy.size.height)
            }
            .scrollIndicators(.hidden)
            .refreshable {
                await onRefresh()
                await model.load()
            }
        }
        .background(Theme.ground.ignoresSafeArea())
        .task { await model.load() }
        // While something is on its way, Home checks every few seconds, so the card turns into a Recent row when it lands.
        .task(id: isMoving) {
            while isMoving, !Task.isCancelled {
                try? await Task.sleep(for: .seconds(4))
                await onRefresh()
            }
        }
        .sheet(item: $selected) { line in
            ActivityDetailSheet(line: line, onReceipt: onOpenPayout)
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(32)
                .presentationBackground(Color(hex: 0x161616))
        }
    }

    private var header: some View {
        HStack {
            Button(action: onMenu) {
                if let photo = model.photoURL {
                    PersonAvatar(name: model.me?.displayName ?? "f", photoURL: photo, size: 36)
                } else {
                    Circle()
                        .fill(Theme.surfaceRaised)
                        .frame(width: 36, height: 36)
                        .overlay(Icon("person.fill", size: 18).foregroundStyle(Theme.textSecondary))
                }
            }
            .accessibilityLabel("Profile")
            Spacer()
            Wordmark()
            Spacer()
            Button(action: onQR) {
                Icon("qrcode", size: 22)
                    .foregroundStyle(Theme.textSecondary)
                    .frame(width: 32, height: 32)
            }
            .accessibilityLabel("Receive with a QR code")
            .accessibilityIdentifier("home.qr")
        }
        .padding(.horizontal, 24)
        .padding(.top, 16)
    }

    static let hiddenAmount = "••••"

    private var balance: some View {
        VStack(spacing: 14) {
            Button { hidesBalance.toggle() } label: {
                IconLabel("Vault balance", icon: hidesBalance ? "eye.slash" : "eye")
                    .labelStyle(TrailingIconLabelStyle())
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 36)
                    .contentShape(Capsule())
            }
            .buttonStyle(.pressable)
            .accessibilityLabel(hidesBalance ? "Show balance" : "Hide balance")
            .accessibilityIdentifier("home.hideBalance")

            Menu {
                Picker("Show balance in", selection: $shown) {
                    ForEach(DisplayCurrency.allCases) { currency in
                        Text("\(currency.name) (\(currency.symbol))").tag(currency)
                    }
                }
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(symbol)
                        .font(.system(size: 30, weight: .light))
                        .foregroundStyle(Theme.textSecondary)
                    Text(hidesBalance ? Self.hiddenAmount : amount)
                        .font(Theme.hero())
                        .tracking(-1.9)
                        .foregroundStyle(Theme.textPrimary)
                        .contentTransition(.numericText())
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                    Icon("chevron.down", size: 14)
                        .foregroundStyle(Theme.textTertiary)
                        .padding(.leading, 6)
                }
                .padding(.horizontal, 24)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .animation(.snappy(duration: 0.25), value: hidesBalance)
            .animation(.snappy(duration: 0.25), value: shown)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(hidesBalance ? "Balance hidden" : symbol + amount)
            .accessibilityHint("Change the currency")
            .accessibilityIdentifier("home.currency")

            ratePill
        }
    }

    /// The local rate being shown, or nil while dollars are shown or the rate hasn't landed yet.
    private var localRate: Rate? { shown.local.flatMap(model.rate(for:)) }

    /// Falls back to dollars until a rate is known, so the balance never shows a made-up figure.
    private var symbol: String { localRate == nil ? "$" : shown.symbol }

    private var amount: String {
        guard let local = shown.local, let value = model.balance(in: local) else { return Money.dollars(model.balance) }
        return Money.grouped(value)
    }

    /// The pill quotes the currency on screen, or naira while dollars are shown.
    private var pillCurrency: Currency { shown.local ?? .ngn }

    @ViewBuilder
    private var ratePill: some View {
        if let rate = model.rate(for: pillCurrency) {
            let value = Text(Money.rate(rate.rate, rate.currency))
                .fontWeight(.medium)
                .foregroundStyle(Theme.textPrimary)
            Group {
                if localRate != nil, !hidesBalance {
                    let dollars = Text("$" + Money.dollars(model.balance)).fontWeight(.medium).foregroundStyle(Theme.textPrimary)
                    Text("\(dollars) · $1 = \(value)")
                } else {
                    Text("$1 = \(value) · \(rate.providersQuoting) quoting")
                }
            }
            .font(.system(size: 13))
            .foregroundStyle(Theme.textSecondary)
            .padding(.horizontal, 14)
            .frame(height: 32)
            .fliqGlass(Capsule())
            .padding(.top, 6)
        } else if model.rateFailed(for: pillCurrency) {
            Text("Rate unavailable")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textTertiary)
                .frame(height: 32)
                .padding(.top, 6)
        } else {
            Capsule()
                .fill(Theme.surface)
                .frame(width: 200, height: 32)
                .padding(.top, 6)
        }
    }
}

private struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 8) {
            configuration.title
            configuration.icon
        }
    }
}

#Preview {
    HomeView(model: HomeModel(api: AppEnvironment.preview.api, vault: AppEnvironment.preview.vault))
}
