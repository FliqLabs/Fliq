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
    let transfers: any VaultTransfers
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
        transfers: any VaultTransfers = FixtureVaultTransfers(),
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
        self.transfers = transfers
        self.preferences = preferences
        agents = AgentStore(api: agentAPI, vault: { profile.name ?? "fliq-vault.testnet" })
        self.biometrics = biometrics
    }

    static func live(bundle: Bundle = .main) -> AppEnvironment {
        #if DEBUG
        if let testing = uiTesting(bundle: bundle) { return testing }
        #endif
        let info = bundle.infoDictionary ?? [:]
        guard let api = liveAPI(info: info) else { return AppEnvironment(api: FixtureClient(bundle: bundle)) }
        let profile = ProfileStore()
        let rpc = (info["FliqNearRPCURL"] as? String).flatMap(URL.init(string:)) ?? URL(string: "https://rpc.testnet.near.org")!
        let transfers = RelayedVaultTransfers(
            api: api,
            rpc: NEARRPC(url: rpc),
            keys: KeychainDeviceKeys(),
            sender: { await profile.name },
            vault: { try? await api.me().vault }
        )
        return AppEnvironment(api: api, isLive: true, profile: profile, transfers: transfers)
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
        let accounts = AccountBook(keychain: nil)
        if arguments.contains("--sample-recipients") { seedRecipients(accounts) }
        return AppEnvironment(
            api: FixtureClient(bundle: bundle), profile: profile, accounts: accounts,
            preferences: Preferences(defaults: defaults), biometrics: AlwaysApprove()
        )
    }

    /// The people on the App Design v5 Pay to screen, for screenshots of a full list.
    private static func seedRecipients(_ accounts: AccountBook) {
        accounts.setOwn(VerifiedAccount(bank: "058", number: "0123456789", accountName: "DARA OKONKWO", institution: "GTBank", country: .ng, logoKey: "gtbank"))
        accounts.save(VerifiedAccount(bank: "999992", number: "8012343301", accountName: "EMEKA STUDIOS LTD", institution: "OPay", country: .ng, logoKey: "opay"))
        accounts.save(VerifiedAccount(bank: "mpesa", number: "0712345412", accountName: "WANJIRU K.", institution: "M-Pesa", country: .ke, logoKey: "mpesa"))
    }
    #endif
}
