import Foundation

/// A fliq name: the `frank` in `frank.fliqaccount.testnet`, a NEAR sub-account the user is paid by.
struct FliqName: Hashable, Sendable {
    /// The API's NEAR root account, from the build settings. Fixture builds use `.fliq.near` like the fixtures.
    static let suffix = (Bundle.main.object(forInfoDictionaryKey: "FliqNameSuffix") as? String).flatMap { $0.isEmpty ? nil : $0 } ?? ".fliq.near"
    static let maxLength = 32

    let value: String

    /// Lowercase letters, digits and single hyphens, 2 to 32 long, no hyphen at either end.
    init?(_ raw: String) {
        let candidate = raw.lowercased()
        guard
            (2...Self.maxLength).contains(candidate.count),
            candidate.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }),
            !candidate.hasPrefix("-"), !candidate.hasSuffix("-"),
            !candidate.contains("--")
        else { return nil }
        value = candidate
    }

    var account: String { value + Self.suffix }
}

protocol NameDirectory: Sendable {
    func isAvailable(_ name: FliqName) async throws -> Bool
}

/// Stands in until the API can check NEAR for an existing sub-account.
struct FixtureNameDirectory: NameDirectory {
    static let taken: Set<String> = ["dara", "tobi", "fliq", "admin", "support"]

    func isAvailable(_ name: FliqName) async throws -> Bool {
        try await Task.sleep(for: .milliseconds(350))
        return !Self.taken.contains(name.value)
    }
}
