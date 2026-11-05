import Foundation
import Observation

@MainActor
@Observable
final class ReceiveFlow {
    static let pollInterval: Duration = .seconds(1.5)

    private(set) var sources: [DepositSource] = []
    var source: DepositSource?
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

    /// What reaches the vault once the deposit is seen; nil until then.
    var landing: TokenAmount? {
        guard let deposit, let received = status?.received else { return nil }
        return deposit.landing(received)
    }

    func loadSources() async {
        guard sources.isEmpty else { return }
        sources = (try? await api.sources()) ?? []
    }

    func reserve() async -> Bool {
        guard let source, !isReserving else { return false }
        isReserving = true
        defer { isReserving = false }
        do {
            deposit = try await api.reserve(source, vault: vaultAccount)
            status = nil
            errorMessage = nil
            return true
        } catch {
            errorMessage = "Couldn't get an address. Check your connection and try again."
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
            if next.stage == .landed, let received = next.received { vault.credit(deposit.landing(received)) }
        }
    }
}

extension ReceiveFlow: Identifiable {}
