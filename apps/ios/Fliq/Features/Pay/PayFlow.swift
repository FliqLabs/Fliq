import Foundation
import Observation

struct Institution: Hashable, Sendable {
    let code: String
    let name: String

    /// Only banks with a fixture behind them are listed until the spec has an institutions endpoint.
    static let supported = [Institution(code: "058", name: "GTBank")]
}

@MainActor
@Observable
final class PayFlow {
    static let accountNumberLength = 10
    static let pollInterval: Duration = .seconds(1.5)

    var institution = Institution.supported[0]
    var accountNumber = "" {
        didSet { if accountNumber != oldValue { verified = nil } }
    }
    var saveAccount = true
    private(set) var verified: VerifiedAccount?
    private(set) var isVerifying = false

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

    init(api: any FliqAPI) {
        self.api = api
    }

    // MARK: Recipient

    var isAccountNumberComplete: Bool {
        accountNumber.count == Self.accountNumberLength && accountNumber.allSatisfy(\.isNumber)
    }

    func verifyAccount() async {
        guard isAccountNumberComplete, verified == nil, !isVerifying else { return }
        isVerifying = true
        defer { isVerifying = false }
        do {
            verified = try await api.verify(Account(bank: institution.code, number: accountNumber))
            errorMessage = nil
        } catch {
            errorMessage = "We couldn't confirm this account with \(institution.name)."
        }
    }

    // MARK: Amount

    var amount: TokenAmount? { TokenAmount(decimalString: amountText) }

    var estimatedReceive: Int? {
        guard let amount, let rate else { return nil }
        return Money.estimate(amount, at: rate.rate)
    }

    func loadRate() async {
        guard rate == nil else { return }
        rate = try? await api.rate(.usdc, .ngn)
    }

    func tapKey(_ key: String) {
        if key == "⌫" {
            if !amountText.isEmpty { amountText.removeLast() }
            return
        }
        if key == "." && amountText.contains(".") { return }
        if let dot = amountText.firstIndex(of: "."), amountText[dot...].count > 2 { return }
        let next: String
        switch (amountText, key) {
        case ("", "."): next = "0."
        case ("0", _) where key != ".": next = key
        default: next = amountText + key
        }
        if next.count <= 9 { amountText = next }
    }

    // MARK: Quote and send

    func fetchQuote() async -> Bool {
        guard let amount, amount > .zero else { return false }
        isQuoting = true
        defer { isQuoting = false }
        do {
            let quote = try await api.quote(QuoteRequest(token: .usdc, currency: .ngn, amount: amount))
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

    func send() async -> Bool {
        guard let quote, let verified, !isSending else { return false }
        isSending = true
        defer { isSending = false }
        do {
            let account = Account(bank: verified.bank, number: verified.number)
            payout = try await api.createPayout(
                PayoutRequest(quoteId: quote.quoteId, account: account),
                idempotencyKey: UUID().uuidString
            )
            sentAt = .now
            errorMessage = nil
            return true
        } catch APIError.refused(let refusal) {
            errorMessage = refusal.error.message
            return false
        } catch {
            errorMessage = "The payout didn't start. Nothing moved."
            return false
        }
    }

    /// Polls until the payout reaches a final state. Only a bank reference counts as paid.
    func track() async {
        while let current = payout, !current.state.isFinal, !Task.isCancelled {
            try? await Task.sleep(for: Self.pollInterval)
            if let next = try? await api.payout(id: current.payoutId) {
                payout = next
            }
        }
    }
}
