import Foundation
import Observation
import Security

@MainActor
@Observable
final class PayFlow {
    static let pollInterval: Duration = .seconds(1.5)

    let recipient: AccountEntry
    var saveAccount = true
    var verified: VerifiedAccount? { recipient.verified }
    var currency: Currency { recipient.country.currency }

    /// The currency the keypad types in. `amountText` is always in this unit.
    enum AmountUnit { case dollars, local }

    private(set) var unit: AmountUnit = .dollars
    private(set) var amountText = ""
    private(set) var rate: Rate?

    private(set) var quote: Quote?
    private(set) var quoteExpiresAt: Date?
    private(set) var isQuoting = false

    private(set) var payout: Payout?
    private(set) var sentAt: Date?
    private(set) var isSending = false

    private(set) var errorMessage: String?

    private let api: any FliqAPI
    private let activity: ActivityStore?
    private let vault: VaultStore?
    private let transfers: (any VaultTransfers)?

    private let accounts: AccountBook?

    /// `startsInLocal` opens the keypad in the bank's currency: set when the owner shows their balance in a local currency.
    init(api: any FliqAPI, activity: ActivityStore? = nil, vault: VaultStore? = nil, accounts: AccountBook? = nil, transfers: (any VaultTransfers)? = nil, startsInLocal: Bool = false) {
        unit = startsInLocal ? .local : .dollars
        self.transfers = transfers
        self.accounts = accounts
        self.api = api
        self.activity = activity
        self.vault = vault
        recipient = AccountEntry(api: api)
    }

    // MARK: Amount

    var amount: TokenAmount? {
        switch unit {
        case .dollars:
            return TokenAmount(decimalString: amountText)
        case .local:
            guard let rate, let typed = Double(amountText) else { return nil }
            return Money.cost(ofLocal: typed, at: rate.rate)
        }
    }
    var available: TokenAmount { vault?.balance ?? .zero }
    /// More than the vault holds. A flow without a vault (previews) never blocks.
    var isOverBalance: Bool {
        guard vault != nil, let amount else { return false }
        return amount > available
    }

    var estimatedReceive: Int? {
        guard let amount, let rate else { return nil }
        if unit == .local, let typed = Double(amountText) { return Int(typed) }
        return Money.estimate(amount, at: rate.rate)
    }

    var canSwitchUnit: Bool { rate != nil }

    /// Types in the other currency from here on, carrying the amount across at the shown rate.
    func switchUnit() {
        guard canSwitchUnit else { return }
        switch unit {
        case .dollars:
            let carried = amountText.isEmpty ? "" : estimatedReceive.map(String.init) ?? ""
            unit = .local
            amountText = carried
        case .local:
            var carried = amountText.isEmpty ? "" : amount?.decimalString ?? ""
            if carried.hasSuffix(".00") { carried.removeLast(3) }
            unit = .dollars
            amountText = carried
        }
    }

    func loadRate() async {
        guard rate?.currency != currency else { return }
        rate = try? await api.rate(.usdc, currency)
        // Without a rate a local amount can't be priced, so the keypad goes back to dollars rather than stall.
        if rate == nil, unit == .local {
            unit = .dollars
            amountText = ""
        }
    }

    @discardableResult
    func enterAmount(_ typed: String) -> String {
        amountText = AmountTyping.clean(typed, previous: amountText)
        return amountText
    }

    // MARK: Quote and send

    func fetchQuote() async -> Bool {
        guard let amount, amount > .zero else { return false }
        isQuoting = true
        defer { isQuoting = false }
        do {
            let quote = try await api.quote(QuoteRequest(token: .usdc, currency: currency, amount: amount))
            self.quote = quote
            quoteExpiresAt = .now.addingTimeInterval(TimeInterval(quote.expiresIn))
            errorMessage = nil
            return true
        } catch {
            errorMessage = "No quote right now. Try again in a moment."
            return false
        }
    }

    func secondsLeft(at date: Date) -> Int {
        guard let quoteExpiresAt else { return 0 }
        return max(0, Int(quoteExpiresAt.timeIntervalSince(date).rounded(.up)))
    }

    /// A cash-out the API registered but the payer has not signed yet. Tapping Send again signs this one instead of
    /// asking for another. The API releases an unsigned one after three minutes, so it is only reused well before that.
    private var unsigned: (quoteId: String, account: Account, payout: Payout, at: Date)?
    static let unsignedReuse: TimeInterval = 120

    func send() async -> Bool {
        guard let quote, let verified, !isSending else { return false }
        isSending = true
        defer { isSending = false }
        do {
            let account = Account(bank: verified.bank, number: verified.number)
            let created: Payout
            if let unsigned, unsigned.quoteId == quote.quoteId, unsigned.account == account, Date.now.timeIntervalSince(unsigned.at) < Self.unsignedReuse {
                created = unsigned.payout
            } else {
                created = try await api.createPayout(PayoutRequest(quoteId: quote.quoteId, to: verified), idempotencyKey: UUID().uuidString)
                unsigned = (quote.quoteId, account, created, .now)
            }
            // A cash-out from the vault moves only once the payer signs the vault's payout for this order.
            _ = try await transfers?.release(created)
            unsigned = nil
            payout = created
            sentAt = .now
            if let payout {
                activity?.record(payout, at: sentAt ?? .now)
                vault?.debit(payout.amount)
                showLive(payout, to: verified)
                if saveAccount { accounts?.save(verified) }
            }
            errorMessage = nil
            return true
        } catch APIError.refused(let refusal) {
            errorMessage = refusal.error.message
            return false
        } catch APIError.server(_, let detail) {
            errorMessage = "\(detail.message) Nothing moved."
            return false
        } catch TransferError.refused(let reason) {
            unsigned = nil
            errorMessage = "The vault refused it: \(reason). Nothing moved."
            return false
        } catch let error as KeychainError where error.status == errSecUserCanceled || error.status == errSecAuthFailed {
            // Face ID was cancelled. Nothing moved; Send asks again for the same cash-out.
            errorMessage = nil
            return false
        } catch TransferError.stillPending {
            unsigned = nil
            errorMessage = "Your vault hasn't confirmed yet. Check Activity in a minute before trying again."
            return false
        } catch {
            errorMessage = "The payout didn't start. Nothing moved."
            return false
        }
    }

    /// The cash-out in the Dynamic Island and on the Lock Screen, so the user never waits on this screen.
    private func showLive(_ payout: Payout, to account: VerifiedAccount) {
        let attributes = MoneyActivityAttributes(
            kind: .payout,
            refId: payout.payoutId,
            amount: "$\(Money.dollars(payout.amount))",
            from: "Vault",
            to: LiveMoney.bankLine(institution: account.institution, number: account.number),
            fromMark: "fliq",
            toMark: account.logoKey.map { "Bank-\($0)" }
        )
        LiveMoney.shared.show(attributes, LiveMoney.payout(payout.state), final: payout.state.isFinal)
    }

    /// Polls until the payout reaches a final state. Only a bank reference counts as paid.
    func track() async {
        while let current = payout, !current.state.isFinal, !Task.isCancelled {
            try? await Task.sleep(for: Self.pollInterval)
            if let next = try? await api.payout(id: current.payoutId) {
                payout = next
                activity?.record(next)
                if let verified { showLive(next, to: verified) }
                if next.state == .refunded, current.state != .refunded { vault?.credit(next.amount) }
            }
        }
    }
}
