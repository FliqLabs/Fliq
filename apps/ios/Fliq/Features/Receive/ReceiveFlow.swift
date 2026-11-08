import Foundation
import Observation

/// Receive: pick a currency, then its network, then show the address and watch for the money.
@MainActor
@Observable
final class ReceiveFlow {
    var pollInterval: Duration = .seconds(3)

    private(set) var sources: [DepositSource] = []
    private(set) var isLoading = false
    var source: DepositSource?
    private(set) var deposit: DepositAddress?
    private(set) var status: DepositStatus?
    private(set) var isReserving = false
    private(set) var errorMessage: String?
    /// Sources the API refused to open an address for this session, with its reason.
    private(set) var unavailable: [String: String] = [:]

    /// The user's fliq name, which is also their direct NEAR address.
    let name: String?

    private let api: any DepositAPI
    private let vault: VaultStore
    private let vaultAccount: String

    init(api: any DepositAPI, vault: VaultStore, vaultAccount: String, name: String? = nil) {
        self.api = api
        self.vault = vault
        self.vaultAccount = vaultAccount
        self.name = name
    }

    /// One row per token, grouped the way Choose currency shows them. USDC on NEAR is one of USDC's networks.
    var currencies: [(group: DepositSource.Group, tokens: [String])] {
        [DepositSource.Group.dollars, .bitcoin].compactMap { group in
            var tokens: [String] = []
            for source in sources where (source.isDirect ? .dollars : source.group) == group && !tokens.contains(source.tokenId) {
                tokens.append(source.tokenId)
            }
            return tokens.isEmpty ? nil : (group, tokens)
        }
    }

    func networks(for token: String) -> [DepositSource] {
        sources.filter { $0.tokenId == token }.sorted { lhs, rhs in
            if lhs.isDirect != rhs.isDirect { return lhs.isDirect }
            return lhs.etaSeconds < rhs.etaSeconds
        }
    }

    func reason(unavailable source: DepositSource) -> String? {
        guard source.available else { return "Not offered right now" }
        return unavailable[source.id]
    }

    /// What reaches the vault once the deposit is seen; nil until then.
    var landing: TokenAmount? {
        if let landed = status?.landed { return landed }
        guard let deposit, let received = status?.received else { return nil }
        return deposit.landing(received)
    }

    /// A free Render instance takes most of a minute to wake, so a first failure is tried once more before it shows.
    func loadSources() async {
        guard sources.isEmpty, !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        for attempt in 1...2 {
            do {
                sources = try await api.sources()
                errorMessage = nil
                return
            } catch {
                errorMessage = Self.message(for: error)
                if attempt == 1, !Task.isCancelled { try? await Task.sleep(for: retryDelay) }
            }
        }
    }

    var retryDelay: Duration = .seconds(2)

    private static func message(for error: Error) -> String {
        switch error {
        case APIError.server(status: 401, _), APIError.unexpected(status: 401):
            "Your session ended. Sign out in Settings and sign back in with your passkey."
        case APIError.server(let status, let detail):
            "The server said no (\(status)): \(detail.message)"
        case let error as URLError where error.code == .timedOut:
            "fliq's server is waking up. Try again in a moment."
        case is URLError:
            "No connection to fliq. Check your internet and try again."
        default:
            "Couldn't read where you can receive from. Try again."
        }
    }

    func reserve(_ source: DepositSource) async -> Bool {
        guard !isReserving else { return false }
        self.source = source
        isReserving = true
        defer { isReserving = false }
        do {
            deposit = try await api.reserve(source, vault: vaultAccount)
            status = nil
            errorMessage = nil
            return true
        } catch let refusal as DepositUnavailable {
            unavailable[source.id] = refusal.message
            return false
        } catch {
            errorMessage = "Couldn't get an address. Check your connection and try again."
            return false
        }
    }

    func secondsLeft(at date: Date) -> Int {
        guard let deposit else { return 0 }
        return max(0, Int(deposit.reservedUntil.timeIntervalSince(date)))
    }

    /// Polls until the deposit is in the vault or given back, then credits the balance once.
    func track() async {
        guard let deposit, deposit.depositId != nil || deposit.isDemo else { return }
        while !(status?.stage.isFinal ?? false), !Task.isCancelled {
            try? await Task.sleep(for: pollInterval)
            guard let next = try? await api.status(of: deposit) else { continue }
            status = next
            if next.stage == .landed, let landing { vault.credit(landing) }
        }
    }
}

extension ReceiveFlow: Identifiable {}
