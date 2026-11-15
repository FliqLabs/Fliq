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

            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text("$")
                    .font(.system(size: 30, weight: .light))
                    .foregroundStyle(Theme.textSecondary)
                Text(hidesBalance ? Self.hiddenAmount : Money.dollars(model.balance))
                    .font(Theme.hero())
                    .tracking(-1.9)
                    .foregroundStyle(Theme.textPrimary)
                    .contentTransition(.numericText())
            }
            .animation(.snappy(duration: 0.25), value: hidesBalance)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(hidesBalance ? "Balance hidden" : "$\(Money.dollars(model.balance))")

            ratePill
        }
    }

    @ViewBuilder
    private var ratePill: some View {
        if let rate = model.rate {
            let value = Text(Money.rate(rate.rate, rate.currency))
                .fontWeight(.medium)
                .foregroundStyle(Theme.textPrimary)
            Text("$1 = \(value) · \(rate.providersQuoting) quoting")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
                .padding(.horizontal, 14)
                .frame(height: 32)
                .fliqGlass(Capsule())
                .padding(.top, 6)
        } else if model.rateFailed {
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
