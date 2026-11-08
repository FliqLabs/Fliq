import SwiftUI

enum HomeTab {
    case balance, activity
}

struct HomeView<Activity: View>: View {
    @State var model: HomeModel
    @Binding var tab: HomeTab
    var onMoveMoney: () -> Void = {}
    var onMenu: () -> Void = {}
    /// Activity shows in place of the balance, so the action bar stays under it.
    @ViewBuilder var activity: () -> Activity

    var body: some View {
        VStack(spacing: 0) {
            header
            switch tab {
            case .balance:
                Spacer()
                balance
                Spacer()
            case .activity:
                activity()
                    .padding(.horizontal, 16)
                    .frame(maxHeight: .infinity, alignment: .top)
            }
            ActionBar(items: actions)
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
        }
        .background(Theme.ground.ignoresSafeArea())
        .task { await model.load() }
    }

    private var header: some View {
        HStack {
            Button(action: onMenu) {
                Circle()
                    .fill(Theme.surfaceRaised)
                    .frame(width: 32, height: 32)
                    .overlay(Image(systemName: "person.fill").font(.system(size: 14)).foregroundStyle(Theme.textSecondary))
            }
            .accessibilityLabel("Profile")
            Spacer()
            Button { tab = .balance } label: { Wordmark() }
                .accessibilityLabel("fliq")
            Spacer()
            Button(action: onMenu) {
                Image(systemName: "line.3.horizontal.decrease")
                    .font(.system(size: 18))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(width: 32, height: 32)
            }
            .accessibilityLabel("Menu")
        }
        .padding(.horizontal, 24)
        .padding(.top, 16)
    }

    private var balance: some View {
        VStack(spacing: 14) {
            Label("Vault balance", systemImage: "eye")
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

    private var actions: [ActionBarItem] {
        [
            ActionBarItem(title: "Home", symbol: "house", isSelected: tab == .balance) { tab = .balance },
            ActionBarItem(title: "Send, receive or request", symbol: "arrow.up.arrow.down", isProminent: true, action: onMoveMoney),
            ActionBarItem(title: "Activity", symbol: "clock.arrow.circlepath", isSelected: tab == .activity) { tab = .activity },
        ]
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
    HomeView(model: HomeModel(api: AppEnvironment.preview.api, vault: AppEnvironment.preview.vault), tab: .constant(.balance)) {
        EmptyView()
    }
}
