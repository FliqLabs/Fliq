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
        let explorer: URL?
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

    private let withdrawals: any Withdrawals
    private let vault: VaultStore?
    private let network: NearNetwork
    private let onLeftVault: () async -> Void

    init(withdrawals: any Withdrawals, vault: VaultStore? = nil, network: NearNetwork = .testnet, onLeftVault: @escaping () async -> Void = {}) {
        self.withdrawals = withdrawals
        self.vault = vault
        self.network = network
        self.onLeftVault = onLeftVault
    }

    var address: String { WithdrawAddress.normalized(addressText) }
    var amount: TokenAmount? { TokenAmount(decimalString: amountText) }
    var available: TokenAmount { vault?.balance ?? .zero }

    var needsSetup: Bool { check == .ready(needsSetup: true) }

    var canSend: Bool {
        guard case .ready = check, let amount, amount > .zero, !isSending else { return false }
        return vault == nil || amount <= available
    }

    @discardableResult
    func enterAmount(_ typed: String) -> String {
        amountText = AmountTyping.clean(typed, previous: amountText)
        errorMessage = nil
        return amountText
    }

    func useEverything() {
        amountText = Money.dollars(available)
        errorMessage = nil
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

    func send() async -> Bool {
        guard canSend, let amount else { return false }
        isSending = true
        defer { isSending = false }
        do {
            let receipt = try await withdrawals.send(amount, to: address)
            vault?.debit(amount)
            sent = Sent(
                amount: amount,
                address: address,
                explorer: receipt.transactionHash.isEmpty ? nil : network.explorer(transaction: receipt.transactionHash)
            )
            errorMessage = nil
            await onLeftVault()
            return true
        } catch let error as WithdrawError {
            await explain(error, amount: amount)
        } catch let error as KeychainError where error.status == errSecUserCanceled || error.status == errSecAuthFailed {
            errorMessage = nil
        } catch {
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
        case .needsGas:
            errorMessage = "Your fliq account needs a little NEAR for the network fee. Nothing moved."
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
