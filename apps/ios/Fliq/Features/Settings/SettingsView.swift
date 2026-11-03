import SwiftUI

struct SettingsView: View {
    @Environment(AppEnvironment.self) private var environment
    @State private var showingRates = false
    @State private var confirmingSignOut = false

    private var profile: ProfileStore { environment.profile }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                profileCard.padding(.top, 20)

                SectionLabel(text: "Account").padding(.top, 20)
                group {
                    LinkRow(symbol: "building.columns", title: "Your bank account", value: ownAccountLabel) {
                        environment.router.push(.settingsAccounts)
                    }
                    InfoRow(symbol: "globe", title: "Home currency", value: "NGN")
                    LinkRow(symbol: "bell", title: "Notifications", isLast: true) {
                        environment.router.push(.settingsNotifications)
                    }
                }

                SectionLabel(text: "Limits").padding(.top, 20)
                group {
                    LinkRow(symbol: "sparkles", title: "Agents", value: agentsLabel, isLast: true) {
                        environment.router.push(.agents)
                    }
                }

                SectionLabel(text: "Security").padding(.top, 20)
                group {
                    LinkRow(symbol: "person.badge.key", title: "Passkeys and devices", isLast: true) {
                        environment.router.push(.settingsSecurity)
                    }
                }

                SectionLabel(text: "Others").padding(.top, 20)
                group {
                    LinkRow(symbol: "arrow.left.arrow.right", title: "Live rates, all providers") { showingRates = true }
                    LinkRow(symbol: "rectangle.portrait.and.arrow.right", title: "Sign out", isLast: true) {
                        confirmingSignOut = true
                    }
                }
            }
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .fliqScreen("Settings")
        .task { await environment.agents.load() }
        .sheet(isPresented: $showingRates) {
            LiveRatesSheet()
                .presentationDetents([.medium])
        }
        .confirmationDialog("Sign out of fliq on this iPhone?", isPresented: $confirmingSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) {
                environment.accounts.clear()
                environment.router.reset()
                profile.signOut()
            }
        } message: {
            Text("Your vault and its money stay on NEAR. You can sign back in with your passkey.")
        }
    }

    private var profileCard: some View {
        HStack(spacing: 14) {
            Text(String((profile.displayName ?? profile.name ?? "f").prefix(1)).uppercased())
                .font(.system(size: 22, weight: .semibold))
                .frame(width: 56, height: 56)
                .background(Theme.surfaceRaised, in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text(profile.displayName ?? "Your profile").font(.system(size: 17, weight: .semibold))
                Text(profile.name ?? "No fliq name yet")
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
    }

    private func group<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) { content() }
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
    }

    private var ownAccountLabel: String? {
        environment.accounts.own.map { "\($0.institution) ···\($0.number.suffix(4))" } ?? "Not added"
    }

    private var agentsLabel: String {
        let active = environment.agents.agents.filter { $0.status == .active }.count
        return "\(active) active"
    }
}

/// A settings row that opens something: icon, title, optional value, chevron.
struct LinkRow: View {
    let symbol: String
    let title: String
    var value: String?
    var isLast = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            CardRow(isLast: isLast) {
                Image(systemName: symbol).frame(width: 22)
                Text(title)
                Spacer()
                if let value {
                    Text(value).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textTertiary)
            }
            .contentShape(Rectangle())
        }
        .foregroundStyle(Theme.textPrimary)
    }
}

/// A settings row that only shows a fact.
struct InfoRow: View {
    let symbol: String?
    let title: String
    var detail: String?
    var value: String?
    var isLast = false

    var body: some View {
        CardRow(isLast: isLast) {
            if let symbol { Image(systemName: symbol).frame(width: 22) }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                if let detail { Text(detail).font(.system(size: 13)).foregroundStyle(Theme.textSecondary) }
            }
            Spacer()
            if let value { Text(value).font(.system(size: 13)).foregroundStyle(Theme.textSecondary) }
        }
        .foregroundStyle(Theme.textPrimary)
        .accessibilityElement(children: .combine)
    }
}
