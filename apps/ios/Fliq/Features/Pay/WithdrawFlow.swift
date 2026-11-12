import Foundation
import Observation
import Security

/// Sending dollars from the vault to a NEAR wallet outside fliq: paste an address, type dollars, sign once.
@MainActor
@Observable
final class WithdrawFlow {
    static let checkDelay: Duration = .milliseconds(400)

    struct Sent: Equatable {
        let amount: TokenAmount
        let address: String
        var explorer: URL?
        /// False from Face ID until NEAR confirms the USDC reached the wallet.
        var delivered = false
        var at = Date.now
    }

    var addressText = "" {
        didSet { if addressText != oldValue { check = nil; errorMessage = nil } }
    }
    private(set) var check: AddressCheck?
    private(set) var isChecking = false
    private(set) var amountText = ""
    private(set) var isSending = false
    private(set) var errorMessage: String?
    private(set) var sent: Sent?
    private var prepared: PreparedWithdraw?

    private(set) var recentAddresses: [SentAddresses.Entry]

    private let withdrawals: any Withdrawals
    private let vault: VaultStore?
    private let network: NearNetwork
    private let recents: SentAddresses
    private let onLeftVault: () async -> Void

    init(
        withdrawals: any Withdrawals,
        vault: VaultStore? = nil,
        network: NearNetwork = .testnet,
        recents: SentAddresses = SentAddresses(),
        onLeftVault: @escaping () async -> Void = {}
    ) {
        self.withdrawals = withdrawals
        self.vault = vault
        self.network = network
        self.recents = recents
        self.onLeftVault = onLeftVault
        recentAddresses = recents.entries()
    }

    var address: String { WithdrawAddress.normalized(addressText) }
    var amount: TokenAmount? { TokenAmount(decimalString: amountText) }
    var available: TokenAmount { vault?.balance ?? .zero }


    var isOverBalance: Bool {
        guard let vault, let amount else { return false }
        return amount > vault.balance
    }

    var hasAmount: Bool {
        guard let amount, amount > .zero else { return false }
        return !isOverBalance
    }

    var hasAddress: Bool {
        if case .ready = check { true } else { false }
    }

    var canSend: Bool { hasAmount && hasAddress && !isSending }

    func pick(_ address: String) {
        addressText = address
    }

    @discardableResult
    func enterAmount(_ typed: String) -> String {
        amountText = AmountTyping.clean(typed, previous: amountText)
        errorMessage = nil
        return amountText
    }

    /// Everything in the vault down to the cent. Rounding up could ask for more than the vault holds.
    func useEverything() {
        amountText = Self.cents(available)
        errorMessage = nil
    }

    /// Dollars with exactly two decimals, rounded down.
    static func cents(_ amount: TokenAmount) -> String {
        let cents = amount.baseUnits / (TokenAmount.base / 100)
        return "\(cents / 100)." + String(format: "%02lld", cents % 100)
    }

    /// Runs after typing pauses. The view calls it with `task(id: addressText)`, so a newer keystroke cancels it.
    func checkAddress() async {
        let address = address
        guard !address.isEmpty, check == nil else { return }
        try? await Task.sleep(for: Self.checkDelay)
        guard !Task.isCancelled else { return }
        isChecking = true
        defer { isChecking = false }
        let result = await withdrawals.check(address)
        guard !Task.isCancelled, self.address == address else { return }
        check = result
    }

    /// Reads what the send needs while Review is on screen, so the Face ID tap goes straight to Face ID.
    func prepare() async {
        guard let amount, hasAddress, !isSending else { return }
        if let prepared, prepared.isFresh(for: amount, to: address) { return }
        prepared = try? await withdrawals.prepare(amount, to: address)
    }

    func send() async -> Bool {
        guard canSend, let amount else { return false }
        isSending = true
        defer { isSending = false }
        do {
            let ready = if let prepared, prepared.isFresh(for: amount, to: address) { prepared } else { try await withdrawals.prepare(amount, to: address) }
            prepared = nil
            let signed = try withdrawals.sign(ready)
            sent = Sent(amount: amount, address: address)
            let receipt = try await withdrawals.deliver(signed)
            vault?.debit(amount)
            recents.record(address)
            recentAddresses = recents.entries()
            sent?.delivered = true
            sent?.explorer = receipt.transactionHash.isEmpty ? nil : network.explorer(transaction: receipt.transactionHash)
            errorMessage = nil
            await onLeftVault()
            return true
        } catch let error as WithdrawError {
            sent = nil
            await explain(error, amount: amount)
        } catch let error as KeychainError where error.status == errSecUserCanceled || error.status == errSecAuthFailed {
            sent = nil
            errorMessage = nil
        } catch {
            sent = nil
            errorMessage = "Couldn't reach NEAR. Nothing moved."
        }
        return false
    }

    private func explain(_ error: WithdrawError, amount: TokenAmount) async {
        switch error {
        case .refused(let reason) where reason.contains("INSUFFICIENT") || reason.contains("Insufficient"):
            errorMessage = "Your vault doesn't have enough for this."
        case .refused:
            errorMessage = "The vault didn't send it. Nothing moved."
        case .stillPending:
            errorMessage = "Still confirming on NEAR. Check Activity in a moment before trying again."
        case .invalidAddress(let problem):
            errorMessage = problem
        case .notSetUp:
            errorMessage = "Sign in again to send from your vault."
        case .notDelivered:
            vault?.debit(amount)
            await onLeftVault()
            errorMessage = "$\(Money.dollars(amount)) left your vault but didn't reach that address. It's in your fliq wallet: add it back from Home."
        }
    }
}

/// Wallets this iPhone has sent to, newest first, for the Recent list on Send to.
struct SentAddresses: Sendable {
    struct Entry: Codable, Equatable, Identifiable, Sendable {
        let address: String
        var count: Int
        var lastSent: Date

        var id: String { address }
    }

    private let key = "withdraw.recents"
    nonisolated(unsafe) private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func entries() -> [Entry] {
        guard let data = defaults.data(forKey: key), let saved = try? JSONDecoder().decode([Entry].self, from: data) else { return [] }
        return saved.sorted { $0.lastSent > $1.lastSent }
    }

    func record(_ address: String, at date: Date = .now) {
        var saved = entries()
        if let index = saved.firstIndex(where: { $0.address == address }) {
            saved[index].count += 1
            saved[index].lastSent = date
        } else {
            saved.append(Entry(address: address, count: 1, lastSent: date))
        }
        let kept = Array(saved.sorted { $0.lastSent > $1.lastSent }.prefix(8))
        defaults.set(try? JSONEncoder().encode(kept), forKey: key)
    }
}
