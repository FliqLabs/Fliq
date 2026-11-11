import SwiftUI

struct HomeView: View {
    @State var model: HomeModel
    var onMenu: () -> Void = {}
    var onQR: () -> Void = {}
    var onRefresh: () async -> Void = {}
    var activity: ActivityStore?
    var onSeeAll: () -> Void = {}
    var onOpenPayout: (String) -> Void = { _ in }

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    header
                    Spacer()
                    balance
                    Spacer()
                    VStack(spacing: 12) {
                        if let rows = activity?.rows.prefix(2), !rows.isEmpty {
                            HomeRecentCard(rows: Array(rows), onSeeAll: onSeeAll, onOpen: onOpenPayout)
                        }
                        if let moving = activity?.moving {
                            HomeMovingCard(entry: moving) { onOpenPayout(moving.id) }
                        }
                        WalletArrivedCard(inbox: model.inbox)
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 40)
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

    private var balance: some View {
        VStack(spacing: 14) {
            IconLabel("Vault balance", icon: "eye")
                .labelStyle(TrailingIconLabelStyle())
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)

            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text("$")
                    .font(.system(size: 30, weight: .light))
                    .foregroundStyle(Theme.textSecondary)
                Text(Money.dollars(model.balance))
                    .font(Theme.hero())
                    .tracking(-1.9)
                    .foregroundStyle(Theme.textPrimary)
            }

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
