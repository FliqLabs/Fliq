import Foundation
import Observation

@MainActor
@Observable
final class HomeModel {
    /// The live rate for each currency Home can show, kept on this iPhone so a balance in naira shows on launch
    /// instead of waiting for the network.
    private(set) var rates: [Currency: Rate]
    private(set) var failedRates: Set<Currency> = []
    private(set) var me: User?

    let inbox: WalletInbox
    private let api: any FliqAPI
    private let vault: VaultStore
    private let defaults: UserDefaults
    private static let ratesKey = "home.rates"

    init(api: any FliqAPI, vault: VaultStore = VaultStore(), inbox: WalletInbox = WalletInbox(), defaults: UserDefaults = .standard) {
        self.api = api
        self.vault = vault
        self.inbox = inbox
        self.defaults = defaults
        rates = Self.saved(in: defaults)
    }

    /// Send stays enabled at zero: the vault enforces caps and balance on chain either way.
    var balance: TokenAmount { vault.balance }

    var photoURL: URL? { me?.photoUrl.flatMap(URL.init(string:)) }

    func rate(for currency: Currency) -> Rate? { rates[currency] }

    func rateFailed(for currency: Currency) -> Bool { rates[currency] == nil && failedRates.contains(currency) }

    /// What the vault would pay out in `currency` at the live rate, rounded down so it never promises more.
    func balance(in currency: Currency) -> Int? {
        rates[currency].map { Money.estimate(balance, at: $0.rate) }
    }

    /// Runs on every return to Home, so a photo changed in Settings shows straight away.
    func loadProfile() async {
        if let user = try? await api.me() { me = user }
    }

    func load() async {
        async let profile: Void = loadProfile()
        async let kes: Void = loadRate(.kes)
        await loadRate(.ngn)
        await kes
        await profile
    }

    private func loadRate(_ currency: Currency) async {
        do {
            let fresh = try await api.rate(.usdc, currency)
            guard fresh.currency == currency else { return }
            rates[currency] = fresh
            failedRates.remove(currency)
            save()
        } catch {
            failedRates.insert(currency)
        }
    }

    private func save() {
        let keyed = Dictionary(uniqueKeysWithValues: rates.map { ($0.key.rawValue, $0.value) })
        defaults.set(try? JSONEncoder().encode(keyed), forKey: Self.ratesKey)
    }

    private static func saved(in defaults: UserDefaults) -> [Currency: Rate] {
        guard let data = defaults.data(forKey: ratesKey),
              let keyed = try? JSONDecoder().decode([String: Rate].self, from: data)
        else { return [:] }
        return Dictionary(uniqueKeysWithValues: keyed.compactMap { key, rate in Currency(rawValue: key).map { ($0, rate) } })
    }
}
