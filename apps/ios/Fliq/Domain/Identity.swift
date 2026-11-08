import Foundation

/// Who is signed in. Every profile field is null until onboarding fills it.
struct User: Codable, Sendable, Equatable {
    let userId: String
    let nearAccount: String?
    let displayName: String?
    let occupation: String?
    let vault: String?
    let photoUrl: String?
    var homeCurrency: String?
    var dailyLimit: MoneyAmount?
    var verified: Bool?
}

/// The API's `Money`: a decimal string in the currency's own units, with an uppercase currency code.
struct MoneyAmount: Codable, Sendable, Equatable {
    let amount: String
    let currency: String

    var formatted: String {
        let symbol = ["NGN": "₦", "KES": "KSh ", "GHS": "GH₵", "USD": "$"][currency] ?? "\(currency) "
        let value = Decimal(string: amount) ?? 0
        return symbol + value.formatted(.number.precision(.fractionLength(0...2)))
    }
}

/// A signed-in device, from `GET /sessions`.
struct DeviceSession: Codable, Sendable, Equatable, Identifiable {
    let sessionId: String
    let device: String
    let current: Bool
    let createdAt: Date
    let lastActiveAt: Date

    var id: String { sessionId }
}

struct DeviceSessionList: Codable, Sendable, Equatable {
    let items: [DeviceSession]
}

/// A passkey on the account, from `GET /passkeys`. `hybrid` means it syncs through iCloud Keychain.
struct Passkey: Codable, Sendable, Equatable, Identifiable {
    let passkeyId: String
    let transports: [String]
    let createdAt: Date
    let lastUsedAt: Date?

    var id: String { passkeyId }
}

struct PasskeyList: Codable, Sendable, Equatable {
    let items: [Passkey]
}

struct Session: Codable, Sendable, Equatable {
    let accessToken: String
    let expiresIn: Int
    let refreshToken: String
    let user: User
}

/// Answer to `GET /names/{name}`. `reason` is taken, invalid or reserved when unavailable;
/// kept as text so a new reason from the API doesn't stop the app decoding.
struct NameAvailability: Codable, Sendable, Equatable {
    let name: String
    let available: Bool
    let reason: String?
}

/// The WebAuthn challenge from `/auth/passkeys/*/options`. Only the fields the app reads
/// are typed; the rest of the options object passes through to AuthenticationServices.
struct PasskeyOptions: Codable, Sendable, Equatable {
    struct Options: Codable, Sendable, Equatable {
        struct RelyingParty: Codable, Sendable, Equatable {
            let id: String
            let name: String
        }

        /// Sent only when registering: the new account's handle, base64url like the challenge.
        struct Person: Codable, Sendable, Equatable {
            let id: String
            let name: String
        }

        let challenge: String
        let rp: RelyingParty?
        let user: Person?
        let timeout: Int?
    }

    let challengeId: String
    let options: Options
}

struct EmailLinkSent: Codable, Sendable, Equatable {
    let status: String
}
