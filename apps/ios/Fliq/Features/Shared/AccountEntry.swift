import Foundation
import Observation

/// A bank account being typed in and confirmed by the bank. Used by Pay and by onboarding.
@MainActor
@Observable
final class AccountEntry {
    private(set) var country = Country.ng
    private(set) var institutions = Institution.supported
    var institution = Institution.supported[0] {
        didSet { if institution != oldValue { verified = nil } }
    }
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

    var maxLength: Int { country.numberLengths.upperBound }

    var isComplete: Bool {
        country.numberLengths.contains(number.count) && number.allSatisfy(\.isNumber)
    }

    /// A Nigerian number is checked as soon as its tenth digit lands. A Kenyan one can be shorter, so it waits for a pause.
    var checksOnLastDigit: Bool { number.count == maxLength }

    func choose(_ country: Country) async {
        guard country != self.country else { return }
        self.country = country
        number = ""
        institutions = []
        errorMessage = nil
        await loadInstitutions()
    }

    func loadInstitutions() async {
        let country = country
        guard let listed = try? await api.institutions(in: country), !listed.isEmpty, country == self.country else {
            if institutions.isEmpty { institutions = country == .ng ? Institution.supported : [] }
            return
        }
        institutions = listed
        if !listed.contains(institution), let first = listed.first { institution = first }
    }

    /// Starts from an account the bank already confirmed, such as a saved one.
    func use(_ account: VerifiedAccount) {
        country = account.country ?? .ng
        institution = institutions.first { $0.code == account.bank }
            ?? Institution(code: account.bank, name: account.institution, country: country, logoKey: account.logoKey)
        number = account.number
        verified = account
    }

    func verify() async {
        guard isComplete, verified == nil, !isVerifying else { return }
        isVerifying = true
        errorMessage = nil
        defer { isVerifying = false }
        do {
            var confirmed = try await api.verify(Account(bank: institution.code, number: number))
            confirmed.country = country
            confirmed.logoKey = institution.logoKey
            verified = confirmed
        } catch APIError.server(_, let detail) {
            errorMessage = detail.message
        } catch {
            errorMessage = "We couldn't confirm this account with \(institution.name)."
        }
    }
}
