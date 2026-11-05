import Foundation
import Observation

@MainActor
@Observable
final class ReceiveFlow {
    static let pollInterval: Duration = .seconds(1.5)

    private(set) var sources: [DepositSource] = []
    var source: DepositSource?
    private(set) var amountText = ""
    private(set) var deposit: DepositAddress?
    private(set) var status: DepositStatus?
    private(set) var isReserving = false
    private(set) var errorMessage: String?

    private let api: any DepositAPI
    private let vault: VaultStore
    private let vaultAccount: String

    init(api: any DepositAPI, vault: VaultStore, vaultAccount: String) {
        self.api = api
        self.vault = vault
        self.vaultAccount = vaultAccount
    }

    var amount: TokenAmount? { TokenAmount(decimalString: amountText) }

    var belowMinimum: Bool {
        guard let minimum = source?.minimum, let amount else { return false }
        return amount < minimum
    }

    var canReserve: Bool { (amount ?? .zero) > .zero && !belowMinimum && !isReserving }

    var estimatedLanding: TokenAmount? {
        guard let amount, let source else { return nil }
        let fee = source.isDirect ? .zero : FixtureDepositAPI.fee
        return TokenAmount(baseUnits: max(0, amount.baseUnits - fee.baseUnits))
    }

    func loadSources() async {
        guard sources.isEmpty else { return }
        sources = (try? await api.sources()) ?? []
    }

    func tapKey(_ key: String) {
        amountText = AmountTyping.apply(key, to: amountText)
    }

    func reserve() async -> Bool {
        guard let source else { return false }
        let expected = amount ?? .zero
        isReserving = true
        defer { isReserving = false }
        do {
            deposit = try await api.reserve(source, expected: expected, vault: vaultAccount)
            status = nil
            errorMessage = nil
            return true
        } catch {
            errorMessage = "Couldn't reserve an address. Try again."
            return false
        }
    }

    func secondsLeft(at date: Date) -> Int {
        guard let deposit else { return 0 }
        return max(0, Int(deposit.reservedUntil.timeIntervalSince(date)))
    }

    /// Polls until the deposit is in the vault, then credits the balance once.
    func track() async {
        guard let deposit else { return }
        while status?.stage != .landed, !Task.isCancelled {
            try? await Task.sleep(for: Self.pollInterval)
            guard let next = try? await api.status(of: deposit) else { continue }
            status = next
            if next.stage == .landed { vault.credit(deposit.lands) }
        }
    }
}

extension ReceiveFlow: Identifiable {}
