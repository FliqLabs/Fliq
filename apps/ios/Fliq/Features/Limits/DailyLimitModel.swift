import Foundation
import Observation

@MainActor
@Observable
final class DailyLimitModel {
    private(set) var limits: Limits?
    private(set) var amountText = ""
    private(set) var isWorking = false
    private(set) var message: String?

    private let api: any LimitsAPI
    private let biometrics: any Biometrics

    init(api: any LimitsAPI, biometrics: any Biometrics) {
        self.api = api
        self.biometrics = biometrics
    }

    var typed: TokenAmount? { TokenAmount(decimalString: amountText) }
    var canSave: Bool { !isWorking && typed != nil && typed != limits?.limitAmount }

    /// True when saving the typed amount has to wait a day: it is higher than the limit in force.
    var typedIsRaise: Bool {
        guard let current = limits?.limitAmount, let typed else { return false }
        return typed > current
    }

    func load() async {
        do {
            limits = try await api.limits()
            message = nil
        } catch {
            if limits == nil { message = "We couldn't load your limit. Pull down to try again." }
        }
    }

    @discardableResult
    func enterAmount(_ typed: String) -> String {
        amountText = AmountTyping.clean(typed, previous: amountText)
        return amountText
    }

    func startEditing() {
        amountText = ""
        message = nil
    }

    /// Saves the typed limit. Returns true when the sheet can close.
    func save() async -> Bool {
        guard let typed else { return false }
        return await change("Change your daily limit") { try await self.api.setDailyLimit(typed.decimalString) }
    }

    func remove() async -> Bool {
        await change("Remove your daily limit") { try await self.api.setDailyLimit(nil) }
    }

    func cancelPending() async -> Bool {
        await change("Cancel the change to your daily limit") { try await self.api.cancelPendingLimit() }
    }

    private func change(_ reason: String, _ work: @escaping () async throws -> Limits) async -> Bool {
        guard !isWorking else { return false }
        guard await biometrics.approve(reason) else { return false }
        isWorking = true
        defer { isWorking = false }
        do {
            limits = try await work()
            message = nil
            return true
        } catch APIError.server(_, let detail) {
            message = detail.message
        } catch {
            message = "That didn't save. Check your connection and try again."
        }
        return false
    }
}
