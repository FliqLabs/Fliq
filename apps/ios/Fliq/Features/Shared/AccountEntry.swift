import Foundation
import Observation

/// A bank account being typed in and confirmed by the bank. Used by Pay and by onboarding.
@MainActor
@Observable
final class AccountEntry {
    static let numberLength = 10

    private(set) var institutions = Institution.supported
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

    func loadInstitutions() async {
        guard let listed = try? await api.institutions(), !listed.isEmpty else { return }
        institutions = listed
        if !listed.contains(institution), let first = listed.first { institution = first }
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
