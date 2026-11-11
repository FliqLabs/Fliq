import PhotosUI
import SwiftUI

struct SettingsView: View {
    @Environment(AppEnvironment.self) private var environment
    @State private var showingRates = false
    @State private var showingCustody = false
    @State private var confirmingSignOut = false
    @State private var user: User?
    @State private var editingAvatar = false
    @State private var passkeys: [Passkey] = []
    @State private var devices: [DeviceSession] = []

    private var profile: ProfileStore { environment.profile }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                profileCard.padding(.top, 20)

                SectionLabel(text: "Account").padding(.top, 24)
                group {
                    LinkRow(symbol: "building.columns", title: "Your bank account", value: ownAccountLabel) {
                        environment.router.push(.settingsAccounts)
                    } mark: {
                        if let own = environment.accounts.own {
                            InstitutionLogo(logoKey: own.logoKey ?? Institution.supported.first { $0.code == own.bank }?.logoKey, name: own.institution, size: 22)
                        }
                    }
                    InfoRow(symbol: "globe", title: "Home currency", value: homeCurrency.currency.rawValue.uppercased()) {
                        CountryFlag(country: homeCurrency, size: 20)
                    }
                    LinkRow(symbol: "bell", title: "Notifications", isLast: true) {
                        environment.router.push(.settingsNotifications)
                    }
                }

                SectionLabel(text: "Limits").padding(.top, 24)
                group {
                    LinkRow(symbol: "asterisk", symbolColor: Color(hex: 0xE07A4F), title: "Agents", value: agentsLabel) {
                        environment.router.push(.agents)
                    }
                    InfoRow(symbol: "chart.pie", title: "Your daily limit", value: user?.dailyLimit?.formatted ?? "…", isLast: true)
                }

                SectionLabel(text: "Security").padding(.top, 24)
                group {
                    LinkRow(symbol: "person.badge.key", title: "Passkeys", value: passkeyLabel) {
                        environment.router.push(.settingsSecurity)
                    }
                    LinkRow(symbol: "iphone", title: "Devices and sessions", value: devicesLabel) {
                        environment.router.push(.settingsSecurity)
                    }
                    LinkRow(symbol: "lock", title: "How your money is held", isLast: true) { showingCustody = true }
                }

                SectionLabel(text: "Others").padding(.top, 24)
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
        .task { await load() }
        .sheet(isPresented: $showingRates) {
            LiveRatesSheet()
                .presentationDetents([.medium])
        }
        .sheet(isPresented: $showingCustody) {
            CustodySheet(vault: user?.vault)
                .presentationDetents([.medium])
        }
        .confirmationDialog("Sign out of fliq on this iPhone?", isPresented: $confirmingSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) {
                environment.accounts.clear()
                environment.router.reset()
                profile.signOut()
                Task { await environment.api.signOut() }
            }
        } message: {
            Text("Your vault and its money stay on NEAR. You can sign back in with your passkey.")
        }
    }

    private func load() async {
        async let me = try? environment.api.me()
        async let keys = try? environment.api.passkeys().items
        async let sessions = try? environment.api.deviceSessions().items
        async let agents: Void = environment.agents.load()
        user = await me
        passkeys = await keys ?? []
        devices = await sessions ?? []
        await agents
    }

    private var profileCard: some View {
        HStack(spacing: 16) {
            Button { editingAvatar = true } label: {
                PersonAvatar(name: profile.displayName ?? profile.name ?? "f", photoURL: user?.photoUrl.flatMap(URL.init(string:)), size: 64)
                    .overlay(alignment: .bottomTrailing) {
                        Icon("camera", size: 12)
                            .foregroundStyle(.black)
                            .frame(width: 22, height: 22)
                            .background(.white, in: Circle())
                            .overlay(Circle().strokeBorder(Theme.surface, lineWidth: 2))
                    }
            }
            .accessibilityLabel("Edit avatar")
            .sheet(isPresented: $editingAvatar) {
                EditAvatarSheet(
                    user: $user,
                    name: profile.displayName ?? profile.name ?? "f",
                    handle: (user?.nearAccount ?? profile.name).map { FliqName.display($0) }
                )
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(32)
                .presentationBackground(Color(hex: 0x161616))
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(user?.displayName ?? profile.displayName ?? "Your profile").font(.system(size: 19, weight: .semibold))
                Text((user?.nearAccount ?? profile.name).map(FliqName.display) ?? "No fliq name yet")
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Spacer()
            if user?.verified == true { Pill(text: "Verified") }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 16)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18))
    }

    private func group<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) { content() }
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
    }

    private var homeCurrency: Country {
        user?.homeCurrency == "KES" ? .ke : .ng
    }

    private var ownAccountLabel: String? {
        environment.accounts.own.map { "\($0.institution) ···\($0.number.suffix(4))" } ?? "Not added"
    }

    private var agentsLabel: String {
        let active = environment.agents.agents.filter { $0.status == .active }.count
        return "\(active) active"
    }

    private var passkeyLabel: String? {
        guard !passkeys.isEmpty else { return nil }
        return devices.first(where: \.current)?.device ?? "\(passkeys.count) on this account"
    }

    private var devicesLabel: String? {
        devices.isEmpty ? nil : "\(devices.count) signed in"
    }
}

/// Where the money sits, in plain words.
private struct CustodySheet: View {
    let vault: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("How your money is held").font(.system(size: 20, weight: .semibold))
            Text("Your dollars sit in the fliq vault, a smart contract on NEAR, under your own account. Only a key on this iPhone can move them, and it asks for Face ID every time.")
            Text("fliq never holds your key. If fliq went away, your balance would still be on chain under your name.")
            if let vault {
                Text(vault)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(Theme.textTertiary)
            }
            Spacer()
        }
        .font(.system(size: 15))
        .foregroundStyle(Theme.textSecondary)
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .presentationBackground(Color(hex: 0x141414))
    }
}

/// A settings row that opens something: icon, title, optional value, chevron.
struct LinkRow<Mark: View>: View {
    let symbol: String
    var symbolColor: Color = Theme.textPrimary
    let title: String
    var value: String?
    var isLast = false
    let action: () -> Void
    @ViewBuilder var mark: () -> Mark

    var body: some View {
        Button(action: action) {
            CardRow(isLast: isLast) {
                Icon(symbol, size: 22).foregroundStyle(symbolColor)
                Text(title)
                Spacer()
                mark()
                if let value {
                    Text(value).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                }
                Icon("chevron.right", size: 16)
                    .foregroundStyle(Theme.textTertiary)
            }
            .contentShape(Rectangle())
        }
        .foregroundStyle(Theme.textPrimary)
    }
}

extension LinkRow where Mark == EmptyView {
    init(symbol: String, symbolColor: Color = Theme.textPrimary, title: String, value: String? = nil, isLast: Bool = false, action: @escaping () -> Void) {
        self.init(symbol: symbol, symbolColor: symbolColor, title: title, value: value, isLast: isLast, action: action) { EmptyView() }
    }
}

/// A settings row that only shows a fact.
struct InfoRow<Mark: View>: View {
    let symbol: String?
    let title: String
    var detail: String?
    var value: String?
    var isLast = false
    @ViewBuilder var mark: () -> Mark

    var body: some View {
        CardRow(isLast: isLast) {
            if let symbol { Icon(symbol, size: 22) }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                if let detail { Text(detail).font(.system(size: 13)).foregroundStyle(Theme.textSecondary) }
            }
            Spacer()
            mark()
            if let value { Text(value).font(.system(size: 13)).foregroundStyle(Theme.textSecondary) }
        }
        .foregroundStyle(Theme.textPrimary)
        .accessibilityElement(children: .combine)
    }
}

extension InfoRow where Mark == EmptyView {
    init(symbol: String?, title: String, detail: String? = nil, value: String? = nil, isLast: Bool = false) {
        self.init(symbol: symbol, title: title, detail: detail, value: value, isLast: isLast) { EmptyView() }
    }
}
