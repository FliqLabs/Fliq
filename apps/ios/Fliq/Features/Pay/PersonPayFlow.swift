import Foundation
import Observation
import Security

/// Paying another fliq user from the vault: find them by name, type dollars, sign once with Face ID.
@MainActor
@Observable
final class PersonPayFlow {
    static let lookupDelay: Duration = .milliseconds(350)

    var nameText: String {
        didSet { if nameText != oldValue { person = nil; lookupFailed = false } }
    }
    private(set) var person: Person?
    private(set) var isLookingUp = false
    private(set) var lookupFailed = false

    private(set) var amountText = ""
    private(set) var isSending = false
    private(set) var errorMessage: String?
    private(set) var paid: TokenAmount?

    private let api: any FliqAPI
    private let transfers: any VaultTransfers
    private let vault: VaultStore?

    init(api: any FliqAPI, transfers: any VaultTransfers, vault: VaultStore? = nil, account: String? = nil) {
        self.api = api
        self.transfers = transfers
        self.vault = vault
        nameText = account.map { $0.hasSuffix(FliqName.suffix) ? String($0.dropLast(FliqName.suffix.count)) : $0 } ?? ""
    }

    var account: String? { FliqName(nameText)?.account }
    var amount: TokenAmount? { TokenAmount(decimalString: amountText) }
    var available: TokenAmount { vault?.balance ?? .zero }

    var canPay: Bool {
        guard person != nil, let amount, amount > .zero, !isSending else { return false }
        return vault == nil || amount <= available
    }

    func tapKey(_ key: String) {
        amountText = AmountTyping.apply(key, to: amountText)
        errorMessage = nil
    }

    /// Runs after typing pauses. The view calls it with `task(id: nameText)`, so a newer keystroke cancels it.
    func lookUp() async {
        guard let account, person == nil else { return }
        try? await Task.sleep(for: Self.lookupDelay)
        guard !Task.isCancelled else { return }
        isLookingUp = true
        defer { isLookingUp = false }
        do {
            let found = try await api.person(named: account)
            guard !Task.isCancelled, self.account == account else { return }
            person = found
        } catch {
            guard !Task.isCancelled else { return }
            lookupFailed = true
        }
    }

    func pay() async -> Bool {
        guard canPay, let amount, let person else { return false }
        isSending = true
        defer { isSending = false }
        do {
            _ = try await transfers.send(amount, to: person.nearAccount)
            vault?.debit(amount)
            paid = amount
            errorMessage = nil
            return true
        } catch TransferError.refused(let reason) where reason.contains("INSUFFICIENT_BALANCE") || reason.contains("Insufficient") {
            errorMessage = "Your vault doesn't have enough for this."
        } catch TransferError.stillPending {
            errorMessage = "Still confirming on NEAR. Check Activity in a moment before paying again."
        } catch let error as KeychainError where error.status == errSecUserCanceled || error.status == errSecAuthFailed {
            errorMessage = nil
        } catch {
            errorMessage = "The payment didn't go through. Nothing moved."
        }
        return false
    }
}
