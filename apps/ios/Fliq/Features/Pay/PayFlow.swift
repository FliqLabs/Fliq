import Foundation
import Observation

@MainActor
@Observable
final class PayFlow {
    static let pollInterval: Duration = .seconds(1.5)

    let recipient: AccountEntry
    var saveAccount = true
    var verified: VerifiedAccount? { recipient.verified }

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

    init(api: any FliqAPI, activity: ActivityStore? = nil) {
        self.api = api
        self.activity = activity
        recipient = AccountEntry(api: api)
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
            if let payout { activity?.record(payout, at: sentAt ?? .now) }
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
                activity?.record(next)
            }
        }
    }
}
