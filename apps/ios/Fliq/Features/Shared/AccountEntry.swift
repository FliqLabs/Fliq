import Foundation
import Observation

struct Institution: Hashable, Sendable {
    let code: String
    let name: String

    /// Only banks with a fixture behind them are listed until the spec has an institutions endpoint.
    static let supported = [Institution(code: "058", name: "GTBank")]
}

/// A bank account being typed in and confirmed by the bank. Used by Pay and by onboarding.
@MainActor
@Observable
final class AccountEntry {
    static let numberLength = 10

    var institution = Institution.supported[0]
    var number = "" {
        didSet { if number != oldValue { verified = nil } }
    }
    private(set) var verified: VerifiedAccount?
    private(set) var isVerifying = false
    private(set) var errorMessage: String?

    private let api: any FliqAPI

    init(api: any FliqAPI) {
        self.api = api
    }

    var isComplete: Bool {
        number.count == Self.numberLength && number.allSatisfy(\.isNumber)
    }

    func verify() async {
        guard isComplete, verified == nil, !isVerifying else { return }
        isVerifying = true
        defer { isVerifying = false }
        do {
            verified = try await api.verify(Account(bank: institution.code, number: number))
            errorMessage = nil
        } catch {
            errorMessage = "We couldn't confirm this account with \(institution.name)."
        }
    }
}
