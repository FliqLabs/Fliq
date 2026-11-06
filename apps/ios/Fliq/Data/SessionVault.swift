import Foundation

/// The API session: a short-lived access token and the refresh token that renews it.
/// Kept in the Keychain so a relaunch stays signed in; nothing else in the app sees the tokens.
actor SessionVault {
    struct Tokens: Codable, Equatable, Sendable {
        let accessToken: String
        let refreshToken: String
        let expiresAt: Date
    }

    private static let key = "session.tokens"

    private let keychain: Keychain?
    private(set) var tokens: Tokens?

    /// Pass `nil` for a vault that forgets on relaunch (tests, UI testing).
    init(keychain: Keychain? = Keychain(service: "cash.fliq.session")) {
        self.keychain = keychain
        tokens = keychain?.load(Tokens.self, for: Self.key)
    }

    var isSignedIn: Bool { tokens != nil }

    func store(_ session: Session, now: Date = .now) {
        let tokens = Tokens(
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            expiresAt: now.addingTimeInterval(TimeInterval(session.expiresIn))
        )
        self.tokens = tokens
        try? keychain?.save(tokens, for: Self.key)
    }

    func clear() {
        tokens = nil
        keychain?.delete(Self.key)
    }
}
