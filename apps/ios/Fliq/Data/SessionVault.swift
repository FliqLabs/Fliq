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
    /// Renew this long before the access token runs out, so a request rarely meets a 401 at all.
    static let renewalMargin: TimeInterval = 60

    private let keychain: Keychain?
    private(set) var tokens: Tokens?
    private var renewal: Task<Session?, Error>?
    private var onEnded: (@Sendable () -> Void)?

    /// Pass `nil` for a vault that forgets on relaunch (tests, UI testing).
    init(keychain: Keychain? = Keychain(service: "cash.fliq.session")) {
        self.keychain = keychain
        tokens = keychain?.load(Tokens.self, for: Self.key)
    }

    var isSignedIn: Bool { tokens != nil }

    /// Called once the API refuses the session for good, so the app can go back to sign-in.
    func whenEnded(_ handler: @escaping @Sendable () -> Void) {
        onEnded = handler
    }

    func needsRenewal(now: Date = .now) -> Bool {
        guard let tokens else { return false }
        return tokens.expiresAt.timeIntervalSince(now) < Self.renewalMargin
    }

    func store(_ session: Session, now: Date = .now) {
        let tokens = Tokens(
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            expiresAt: now.addingTimeInterval(TimeInterval(session.expiresIn))
        )
        self.tokens = tokens
        try? keychain?.save(tokens, for: Self.key)
    }

    /// A fresh access token to use instead of `used`. The API revokes every session in the family when a refresh
    /// token is spent twice, so requests that all meet a 401 at once share one renewal instead of racing.
    /// `renew` returns nil when the API refuses the refresh token, which ends the session, and throws when it could
    /// not be asked, which keeps it for the next try.
    func renewedToken(replacing used: String?, with renew: @escaping @Sendable (String) async throws -> Session?) async -> String? {
        if let current = tokens?.accessToken, current != used { return current }
        if let renewal { return try? await renewal.value?.accessToken }
        guard let refreshToken = tokens?.refreshToken else { return nil }
        let task = Task { try await renew(refreshToken) }
        renewal = task
        defer { renewal = nil }
        do {
            guard let session = try await task.value else {
                end()
                return nil
            }
            store(session)
            return session.accessToken
        } catch {
            return nil
        }
    }

    func clear() {
        tokens = nil
        keychain?.delete(Self.key)
    }

    private func end() {
        clear()
        onEnded?()
    }
}
