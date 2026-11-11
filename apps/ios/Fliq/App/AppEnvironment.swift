import Foundation
import Observation
import UIKit

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
    /// The amount that just landed, shown as a banner over any screen for a few seconds.
    private(set) var arrival: TokenAmount?
    @ObservationIgnored private var arrivalWatch: Task<Void, Never>?
    let deposits: any DepositAPI
    let agents: AgentStore
    let accounts: AccountBook
    let transfers: any VaultTransfers
    let withdrawals: any Withdrawals
    /// Nil when no Cloudinary preset is configured: the photo then stays on this iPhone.
    let photos: (any PhotoUploads)?
    let paj: any PajAPI
    let pajSignIn: any PajSignIn
    /// A testnet build's stand-in destination for Paj deposits; nil on mainnet, where they land in the vault.
    let pajTestRecipient: String?
    let inbox: WalletInbox
    let preferences: Preferences
    let biometrics: any Biometrics
    let lock: AppLock

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
        withdrawals: any Withdrawals = FixtureWithdrawals(),
        photos: (any PhotoUploads)? = FixturePhotoUploads(),
        paj: (any PajAPI)? = nil,
        pajSignIn: (any PajSignIn)? = nil,
        pajTestRecipient: String? = "demo-wallet",
        walletTopUp: any WalletTopUp = FixtureWalletTopUp(),
        preferences: Preferences = Preferences(),
        biometrics: any Biometrics = DeviceBiometrics(),
        lock: AppLock = AppLock()
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
        self.withdrawals = withdrawals
        self.photos = photos
        let demoPaj = FixturePaj()
        self.paj = paj ?? demoPaj
        self.pajSignIn = pajSignIn ?? demoPaj
        self.pajTestRecipient = pajTestRecipient
        inbox = WalletInbox(topUp: walletTopUp)
        self.preferences = preferences
        agents = AgentStore(api: agentAPI, vault: { profile.name ?? NearNetwork.current.vault })
        self.biometrics = biometrics
        self.lock = lock
        inbox.onAdded = { [weak self] in await self?.refreshVault() }
    }

    static func live(bundle: Bundle = .main) -> AppEnvironment {
        #if DEBUG
        if let testing = uiTesting(bundle: bundle) { return testing }
        #endif
        let info = bundle.infoDictionary ?? [:]
        guard let api = liveAPI(info: info) else { return AppEnvironment(api: FixtureClient(bundle: bundle)) }
        let profile = ProfileStore()
        let rpc = (info["FliqNearRPCURL"] as? String).flatMap(URL.init(string:)) ?? URL(string: "https://rpc.testnet.near.org")!
        let keys = KeychainDeviceKeys()
        let transfers = RelayedVaultTransfers(
            api: api,
            rpc: NEARRPC(url: rpc),
            keys: keys,
            sender: { await profile.name },
            vault: { try? await api.me().vault }
        )
        let agents = HTTPAgentAPI(
            client: api,
            relay: DelegateRelay(api: api, rpc: NEARRPC(url: rpc), keys: keys),
            owner: { await profile.name }
        )
        let walletTopUp = RelayedWalletTopUp(
            rpc: NEARRPC(url: rpc),
            relay: DelegateRelay(api: api, rpc: NEARRPC(url: rpc), keys: keys),
            owner: { await profile.name },
            vault: { try? await api.me().vault }
        )
        let withdrawals = RelayedWithdrawals(
            api: api,
            rpc: NEARRPC(url: rpc),
            keys: keys,
            owner: { await profile.name },
            vault: { try? await api.me().vault }
        )
        let environment = AppEnvironment(
            api: api, isLive: true, profile: profile, deposits: HTTPDepositAPI(client: api), agentAPI: agents,
            transfers: transfers, withdrawals: withdrawals, photos: cloudinary(info: info),
            paj: HTTPPaj(), pajSignIn: pajSignIn(info: info, api: api),
            pajTestRecipient: (info["FliqPajTestRecipient"] as? String).flatMap { $0.isEmpty ? nil : $0 },
            walletTopUp: walletTopUp
        )
        Task {
            await api.sessions.whenEnded {
                Task { @MainActor in environment.signedOutByServer() }
            }
        }
        return environment
    }

    static let preview = AppEnvironment(
        api: FixtureClient(),
        profile: ProfileStore(defaults: UserDefaults(suiteName: "preview") ?? .standard),
        biometrics: AlwaysApprove(),
        lock: .off()
    )

    private static func pajSignIn(info: [String: Any], api: HTTPClient) -> WebPajSignIn {
        let web = (info["FliqWebBaseURL"] as? String).flatMap(URL.init(string:)) ?? URL(string: "https://fliq.cash")!
        let device = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
        return WebPajSignIn(base: web, bearer: { await api.sessions.tokens?.accessToken }, deviceID: device)
    }

    private static func cloudinary(info: [String: Any]) -> CloudinaryUploads? {
        guard
            let cloud = info["FliqCloudinaryCloud"] as? String, !cloud.isEmpty,
            let preset = info["FliqCloudinaryPreset"] as? String, !preset.isEmpty
        else { return nil }
        return CloudinaryUploads(cloud: cloud, preset: preset)
    }

    private static func liveAPI(info: [String: Any]) -> HTTPClient? {
        guard
            info["FliqDataSource"] as? String == "api",
            let base = (info["FliqAPIBaseURL"] as? String).flatMap(URL.init(string:))
        else { return nil }
        return HTTPClient(baseURL: base, apiKey: info["FliqAPIKey"] as? String ?? "")
    }

    /// The API refused the session for good: back to sign-in, keeping this iPhone's saved accounts and its device key.
    func signedOutByServer() {
        router.reset()
        profile.signOut()
    }

    /// Forgot the app passcode: sign out and clear the lock. Signing back in with the passkey loses nothing.
    func forgotPasscode() async {
        await api.signOut()
        lock.reset()
        signedOutByServer()
    }

    /// Reads the balance from the API. On fixtures the vault mirrors this device's own top-ups and payouts.
    func refreshVault() async {
        guard isLive, let balance = try? await api.vaultBalance() else { return }
        vault.sync(balance)
    }

    /// Loads the account's history. Fixture builds keep Activity to what this device did, as the UI tests expect,
    /// unless `--sample-activity` asks for the fixture history.
    func refreshActivity() async {
        guard isLive || ProcessInfo.processInfo.arguments.contains("--sample-activity") else { return }
        await activity.load(from: api)
    }

    /// Deposits land minutes after the person has left the screen they started on, and nothing pushes the news to
    /// the phone, so once a deposit starts the app checks the balance quietly until it rises or the window closes.
    func watchForArrival(every interval: Duration = .seconds(5), for window: Duration = .seconds(900)) {
        guard isLive else { return }
        arrivalWatch?.cancel()
        arrivalWatch = Task { [weak self] in
            guard let self else { return }
            await refreshVault()
            var floor = vault.balance.baseUnits
            let end = ContinuousClock.now + window
            while !Task.isCancelled, ContinuousClock.now < end {
                try? await Task.sleep(for: interval)
                await refreshVault()
                let now = vault.balance.baseUnits
                if now > floor {
                    announceArrival(TokenAmount(baseUnits: now - floor))
                    await refreshActivity()
                    return
                }
                floor = min(floor, now)
            }
        }
    }

    func announceArrival(_ amount: TokenAmount) {
        arrival = amount
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(5))
            if self?.arrival == amount { self?.arrival = nil }
        }
    }

    #if DEBUG
    /// `--ui-testing` runs on fixtures with a fresh profile and no Face ID prompt.
    /// Add `--onboarded` to start on Home, and `--funded` for $100 in the vault so a cash-out can be quoted.
    private static func uiTesting(bundle: Bundle) -> AppEnvironment? {
        let arguments = ProcessInfo.processInfo.arguments
        guard arguments.contains("--ui-testing"), let defaults = UserDefaults(suiteName: "ui-testing") else { return nil }
        defaults.removePersistentDomain(forName: "ui-testing")
        let profile = ProfileStore(defaults: defaults)
        if arguments.contains("--onboarded") { profile.completeOnboarding(name: nil, displayName: nil) }
        let accounts = AccountBook(keychain: nil)
        if arguments.contains("--sample-recipients") { seedRecipients(accounts) }
        return AppEnvironment(
            api: FixtureClient(bundle: bundle), profile: profile, vault: VaultStore(balance: TokenAmount(baseUnits: arguments.contains("--funded") ? 100_000_000 : 0)), accounts: accounts,
            preferences: Preferences(defaults: defaults), biometrics: AlwaysApprove(), lock: uiTestingLock(arguments, defaults: defaults)
        )
    }

    /// The lock stays out of UI tests unless `--lock-setup` asks for the Secure fliq screen
    /// or `--locked` starts on the lock screen with the passcode 123456.
    private static func uiTestingLock(_ arguments: [String], defaults: UserDefaults) -> AppLock {
        guard arguments.contains("--lock-setup") || arguments.contains("--locked") else { return .off() }
        let lock = AppLock(defaults: defaults, keychain: nil)
        if arguments.contains("--locked") { lock.setPasscode("123456") }
        return lock
    }

    /// The people on the App Design v5 Pay to screen, for screenshots of a full list.
    private static func seedRecipients(_ accounts: AccountBook) {
        accounts.setOwn(VerifiedAccount(bank: "058", number: "0123456789", accountName: "DARA OKONKWO", institution: "GTBank", country: .ng, logoKey: "gtbank"))
        accounts.save(VerifiedAccount(bank: "999992", number: "8012343301", accountName: "EMEKA STUDIOS LTD", institution: "OPay", country: .ng, logoKey: "opay"))
        accounts.save(VerifiedAccount(bank: "mpesa", number: "0712345412", accountName: "WANJIRU K.", institution: "M-Pesa", country: .ke, logoKey: "mpesa"))
    }
    #endif
}
