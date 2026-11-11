import AuthenticationServices
import UIKit

enum PasskeyError: Error, Equatable {
    case cancelled
    /// Asked for a saved passkey only, and this iPhone has none for fliq.cash.
    case noneSaved
    case badOptions
    case failed(String)
}

/// Runs the system passkey sheet and returns the response as the WebAuthn JSON the API verifies.
/// The relying party is fliq.cash, so the app needs the `webcredentials:fliq.cash` associated domain.
@MainActor
final class PasskeyAuthenticator: NSObject {
    private var pending: CheckedContinuation<ASAuthorization, any Error>?
    private var controller: ASAuthorizationController?
    /// Set while asking for saved passkeys only: iOS answers "cancelled" at once when there are none.
    private var quietSince: Date?

    func register(_ options: PasskeyOptions) async throws -> Data {
        guard
            let rp = options.options.rp?.id,
            let user = options.options.user,
            let challenge = Data(base64URL: options.options.challenge),
            let userID = Data(base64URL: user.id)
        else { throw PasskeyError.badOptions }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rp)
        let request = provider.createCredentialRegistrationRequest(challenge: challenge, name: Self.label, userID: userID)
        guard let credential = try await perform(request).credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
              let attestation = credential.rawAttestationObject
        else { throw PasskeyError.failed("No passkey was created.") }

        return try Self.json(id: credential.credentialID, response: [
            "clientDataJSON": credential.rawClientDataJSON.base64URL,
            "attestationObject": attestation.base64URL,
            "transports": ["internal", "hybrid"],
        ])
    }

    /// With `onlySaved`, iOS shows the sheet only if this iPhone already holds a fliq.cash passkey, and
    /// otherwise fails at once with `PasskeyError.noneSaved` so the caller can create one instead.
    func signIn(_ options: PasskeyOptions, relyingParty: String = "fliq.cash", onlySaved: Bool = false) async throws -> Data {
        guard let challenge = Data(base64URL: options.options.challenge) else { throw PasskeyError.badOptions }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: options.options.rp?.id ?? relyingParty)
        let request = provider.createCredentialAssertionRequest(challenge: challenge)
        guard let credential = try await perform(request, onlySaved: onlySaved).credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            throw PasskeyError.failed("No passkey was used.")
        }

        return try Self.json(id: credential.credentialID, response: [
            "clientDataJSON": credential.rawClientDataJSON.base64URL,
            "authenticatorData": credential.rawAuthenticatorData.base64URL,
            "signature": credential.signature.base64URL,
            "userHandle": credential.userID.base64URL,
        ])
    }

    /// What the passkey sheet shows for this passkey. Testnet and mainnet share fliq.cash, so the label tells them apart.
    static var label: String { NearNetwork.current == .testnet ? "fliq testnet" : "fliq" }

    private func perform(_ request: ASAuthorizationRequest, onlySaved: Bool = false) async throws -> ASAuthorization {
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.controller = controller
        defer { self.controller = nil }
        quietSince = onlySaved ? .now : nil
        return try await withCheckedThrowingContinuation { continuation in
            pending = continuation
            if onlySaved {
                controller.performRequests(options: .preferImmediatelyAvailableCredentials)
            } else {
                controller.performRequests()
            }
        }
    }

    private func finish(_ result: Result<ASAuthorization, any Error>) {
        pending?.resume(with: result)
        pending = nil
        quietSince = nil
    }

    /// A cancel that arrives within a moment of a saved-only request means no sheet was shown: there is nothing saved.
    private func failure(_ error: any Error) -> any Error {
        let code = (error as? ASAuthorizationError)?.code
        if let quietSince, code == .canceled || code == .notInteractive, Date.now.timeIntervalSince(quietSince) < 1 {
            return PasskeyError.noneSaved
        }
        return code == .canceled ? PasskeyError.cancelled : PasskeyError.failed(error.localizedDescription)
    }

    private static func json(id: Data, response: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "id": id.base64URL,
            "rawId": id.base64URL,
            "type": "public-key",
            "response": response,
            "clientExtensionResults": [String: Any](),
            "authenticatorAttachment": "platform",
        ])
    }
}

extension PasskeyAuthenticator: ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        MainActor.assumeIsolated { finish(.success(authorization)) }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: any Error) {
        MainActor.assumeIsolated { finish(.failure(failure(error))) }
    }

    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
        }
    }
}

extension Data {
    init?(base64URL text: String) {
        var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        self.init(base64Encoded: base64)
    }

    var base64URL: String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
