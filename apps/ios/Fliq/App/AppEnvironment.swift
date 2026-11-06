import Foundation
import Observation

/// The composition root. The app builds one from Info.plist; tests and previews pass
/// their own parts, so no screen ever constructs a client itself.
@MainActor
@Observable
final class AppEnvironment {
    let api: any FliqAPI
    /// True when `api` is the real server: balances come from it and onboarding signs in first.
    let isLive: Bool
    let names: any NameDirectory
    let router: AppRouter
    let profile: ProfileStore
    let activity: ActivityStore
    let vault: VaultStore
    let deposits: any DepositAPI
    let agents: AgentStore
    let accounts: AccountBook
    let preferences: Preferences
    let biometrics: any Biometrics

    init(
        api: any FliqAPI,
        isLive: Bool = false,
        names: (any NameDirectory)? = nil,
        router: AppRouter = AppRouter(),
        profile: ProfileStore = ProfileStore(),
        activity: ActivityStore = ActivityStore(),
        vault: VaultStore = VaultStore(),
        deposits: any DepositAPI = FixtureDepositAPI(),
        agentAPI: any AgentAPI = FixtureAgentAPI(),
        accounts: AccountBook = AccountBook(),
        preferences: Preferences = Preferences(),
        biometrics: any Biometrics = DeviceBiometrics()
    ) {
        self.api = api
        self.isLive = isLive
        self.names = names ?? (isLive ? APINameDirectory(api: api) : FixtureNameDirectory())
        self.router = router
        self.profile = profile
        self.activity = activity
        self.vault = vault
        self.deposits = deposits
        self.accounts = accounts
        self.preferences = preferences
        agents = AgentStore(api: agentAPI, vault: { profile.name ?? "fliq-vault.testnet" })
        self.biometrics = biometrics
    }

    static func live(bundle: Bundle = .main) -> AppEnvironment {
        #if DEBUG
        if let testing = uiTesting(bundle: bundle) { return testing }
        #endif
        guard let api = liveAPI(info: bundle.infoDictionary ?? [:]) else { return AppEnvironment(api: FixtureClient(bundle: bundle)) }
        return AppEnvironment(api: api, isLive: true)
    }

    static let preview = AppEnvironment(
        api: FixtureClient(),
        profile: ProfileStore(defaults: UserDefaults(suiteName: "preview") ?? .standard),
        biometrics: AlwaysApprove()
    )

    private static func liveAPI(info: [String: Any]) -> HTTPClient? {
        guard
            info["FliqDataSource"] as? String == "api",
            let base = (info["FliqAPIBaseURL"] as? String).flatMap(URL.init(string:))
        else { return nil }
        return HTTPClient(baseURL: base, apiKey: info["FliqAPIKey"] as? String ?? "")
    }

    /// Reads the balance from the API. On fixtures the vault mirrors this device's own top-ups and payouts.
    func refreshVault() async {
        guard isLive, let balance = try? await api.vaultBalance() else { return }
        vault.sync(balance)
    }

    #if DEBUG
    /// `--ui-testing` runs on fixtures with a fresh profile and no Face ID prompt.
    /// Add `--onboarded` to start on Home.
    private static func uiTesting(bundle: Bundle) -> AppEnvironment? {
        let arguments = ProcessInfo.processInfo.arguments
        guard arguments.contains("--ui-testing"), let defaults = UserDefaults(suiteName: "ui-testing") else { return nil }
        defaults.removePersistentDomain(forName: "ui-testing")
        let profile = ProfileStore(defaults: defaults)
        if arguments.contains("--onboarded") { profile.completeOnboarding(name: nil, displayName: nil) }
        return AppEnvironment(
            api: FixtureClient(bundle: bundle), profile: profile, accounts: AccountBook(keychain: nil),
            preferences: Preferences(defaults: defaults), biometrics: AlwaysApprove()
        )
    }
    #endif
}
