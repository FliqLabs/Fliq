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
    /// False from Face ID until the vault confirms the transfer.
    private(set) var isConfirmed = false

    private let api: any FliqAPI
    private let transfers: any VaultTransfers
    private let vault: VaultStore?
    let signing: SigningAccess

    /// The request being paid, when Pay was opened from a request link. The API marks it paid as the transfer lands.
    var requestCode: String?

    init(api: any FliqAPI, transfers: any VaultTransfers, vault: VaultStore? = nil, account: String? = nil, recovery: (any AccountRecovering)? = nil) {
        self.api = api
        signing = SigningAccess(recovery: recovery)
        self.transfers = transfers
        self.vault = vault
        nameText = account.map { $0.hasSuffix(FliqName.suffix) ? String($0.dropLast(FliqName.suffix.count)) : $0 } ?? ""
    }

    var account: String? { FliqName.account(typed: nameText) }
    var amount: TokenAmount? { TokenAmount(decimalString: amountText) }
    var available: TokenAmount { vault?.balance ?? .zero }

    var canPay: Bool {
        guard person != nil, let amount, amount > .zero, !isSending, !signing.isBlocked else { return false }
        return vault == nil || amount <= available
    }

    @discardableResult
    func enterAmount(_ typed: String) -> String {
        amountText = AmountTyping.clean(typed, previous: amountText)
        errorMessage = nil
        return amountText
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
            isConfirmed = false
            _ = try await transfers.send(amount, to: person.nearAccount, paying: requestCode) { [weak self] in
                await MainActor.run { self?.paid = amount }
            }
            vault?.debit(amount)
            paid = amount
            isConfirmed = true
            errorMessage = nil
            return true
        } catch TransferError.refused(let reason) where reason.contains("INSUFFICIENT_BALANCE") || reason.contains("Insufficient") {
            paid = nil
            errorMessage = "Your vault doesn't have enough for this."
        } catch TransferError.stillPending {
            paid = nil
            errorMessage = "Still confirming on NEAR. Check Activity in a moment before paying again."
        } catch {
            paid = nil
            if let failure = SignFailure(error) {
                errorMessage = failure.message
                if failure == .notAdded { await signing.notAdded() }
            } else {
                errorMessage = SignFailure.isCancel(error) ? nil : "The payment didn't go through. Nothing moved."
            }
        }
        return false
    }
}
