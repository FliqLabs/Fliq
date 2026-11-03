import Foundation

/// Who is signed in. Every profile field is null until onboarding fills it.
struct User: Codable, Sendable, Equatable {
    let userId: String
    let nearAccount: String?
    let displayName: String?
    let occupation: String?
    let vault: String?
    let photoUrl: String?
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

        let challenge: String
        let rp: RelyingParty?
        let timeout: Int?
    }

    let challengeId: String
    let options: Options
}

struct EmailLinkSent: Codable, Sendable, Equatable {
    let status: String
}
