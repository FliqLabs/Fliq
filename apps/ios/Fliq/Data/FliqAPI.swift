import Foundation

protocol FliqAPI: Sendable {
    func health() async throws -> Health
    func activity() async throws -> ActivityList
    func rate(_ token: Token, _ currency: Currency) async throws -> Rate
    func quote(_ request: QuoteRequest) async throws -> Quote
    func verify(_ account: Account) async throws -> VerifiedAccount
    func createPayout(_ request: PayoutRequest, idempotencyKey: String) async throws -> Payout
    func payout(id: String) async throws -> Payout
    func payouts() async throws -> PayoutList

    /// True when this client needs a signed-in session before the money endpoints answer.
    var needsSignIn: Bool { get async }
    func passkeyOptions(_ purpose: PasskeyPurpose) async throws -> PasskeyOptions
    /// Sends the platform's passkey response (WebAuthn JSON) and keeps the session it opens.
    func finishPasskey(_ purpose: PasskeyPurpose, challengeId: String, credential: Data) async throws -> User
    func sendEmailLink(to email: String) async throws -> EmailLinkSent
    /// Exchanges the token from a sign-in link for a session and keeps it.
    func verifyEmailLink(token: String) async throws -> User
    func signOut() async
    func me() async throws -> User
    func checkName(_ name: FliqName) async throws -> NameAvailability
    /// Creates the NEAR account behind the name, owned by the device key `publicKey`.
    func claimName(_ name: FliqName, publicKey: String) async throws -> User
    func updateProfile(displayName: String) async throws -> User
    func updateProfilePhoto(_ url: URL) async throws -> User
    func removeProfilePhoto() async throws -> User
    func registerDevice(_ device: PushDevice) async throws
    func unregisterDevice(token: String) async throws
    func registerLiveActivity(_ activity: LiveActivityRegistration) async throws
    func refunds() async throws -> [Refund]
    /// Accounts are saved on the server (`recipients()` lists them), so they survive a reinstall and show on the web.
    func saveRecipient(_ input: RecipientInput) async throws -> Recipient
    func markOwnRecipient(id: String) async throws
    func deleteRecipient(id: String) async throws
    /// The public side of a payment request link. Needs no session.
    func publicRequest(_ link: PayLink) async throws -> PublicPayRequest
    func returnRefund(tokenId: String, idempotencyKey: String) async throws -> ReturnedRefund

    func institutions(in country: Country) async throws -> [Institution]
    func vaultBalance() async throws -> VaultBalance
    func recipients() async throws -> RecipientList
    func recentPeople() async throws -> RecentPeopleList
    func person(named name: String) async throws -> Person
    func relay(signedDelegate: String) async throws -> RelayResult
    func relay(signedDelegate: String, requestCode: String?) async throws -> RelayResult
    func passkeys() async throws -> PasskeyList
    func deviceSessions() async throws -> DeviceSessionList
    func revokeSession(id: String) async throws
    func createRequest(_ input: PaymentRequestInput, idempotencyKey: String) async throws -> PaymentRequest
    func request(id: String) async throws -> PaymentRequest
    func relayResult(hash: String) async throws -> RelayResult
    func notificationSettings() async throws -> NotificationSettings
    func updateNotificationSettings(_ settings: NotificationSettings) async throws -> NotificationSettings
}

enum PasskeyPurpose: String, Sendable {
    case register, login
}

enum FliqJSON {
    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            if let date = fractional.date(from: text) ?? plain.date(from: text) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Not an ISO 8601 date: \(text)"))
        }
        return decoder
    }

    static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return encoder
    }

    // The fixtures write "2026-11-01T00:00:00Z"; the API's toISOString() adds milliseconds.
    nonisolated(unsafe) private static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    nonisolated(unsafe) private static let plain = ISO8601DateFormatter()
}

/// Answers a name check from the API. Needs a session, so onboarding signs in first.
struct APINameDirectory: NameDirectory {
    let api: any FliqAPI

    func isAvailable(_ name: FliqName) async throws -> Bool {
        try await api.checkName(name).available
    }
}

/// This iPhone's address for push notifications, as `POST /devices` takes it.
struct PushDevice: Encodable, Equatable, Sendable {
    let token: String
    var platform = "ios"
    /// "sandbox" for builds run from Xcode, "production" for TestFlight and the App Store.
    let environment: String
    let bundleId: String
}

extension FliqAPI {
    func registerDevice(_ device: PushDevice) async throws {}
    func unregisterDevice(token: String) async throws {}
    func registerLiveActivity(_ activity: LiveActivityRegistration) async throws {}
    func refunds() async throws -> [Refund] { [] }
    func relay(signedDelegate: String, requestCode: String?) async throws -> RelayResult { try await relay(signedDelegate: signedDelegate) }
    func saveRecipient(_ input: RecipientInput) async throws -> Recipient { throw APIError.unexpected(status: 404) }
    func markOwnRecipient(id: String) async throws {}
    func deleteRecipient(id: String) async throws {}
    func publicRequest(_ link: PayLink) async throws -> PublicPayRequest { throw APIError.unexpected(status: 404) }
    func returnRefund(tokenId: String, idempotencyKey: String) async throws -> ReturnedRefund { throw TransferError.notSetUp }
    func notificationSettings() async throws -> NotificationSettings { throw APIError.unexpected(status: 404) }
    func updateNotificationSettings(_ settings: NotificationSettings) async throws -> NotificationSettings { settings }
}

/// Which notifications the user wants, as `/me/notification-settings` keeps them on the server.
struct NotificationSettings: Codable, Equatable, Sendable {
    struct RateAlert: Codable, Equatable, Sendable {
        var enabled: Bool
        /// "NGN" or "KES".
        var currency: String
        var above: Double?

        // The API requires the key even when there is no rate yet, so nil goes out as null.
        func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(enabled, forKey: .enabled)
            try container.encode(currency, forKey: .currency)
            try container.encode(above, forKey: .above)
        }
    }

    var received: Bool
    var payoutPaid: Bool
    var payoutRefunded: Bool
    var agentPaid: Bool
    var agentRefused: Bool
    var capAlmostReached: Bool
    var rateAlert: RateAlert
    var weeklySummary: Bool
}
