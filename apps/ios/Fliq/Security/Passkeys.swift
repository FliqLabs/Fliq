import AuthenticationServices
import UIKit

enum PasskeyError: Error, Equatable {
    case cancelled
    case badOptions
    case failed(String)
}

/// Runs the system passkey sheet and returns the response as the WebAuthn JSON the API verifies.
/// The relying party is fliq.cash, so the app needs the `webcredentials:fliq.cash` associated domain.
@MainActor
final class PasskeyAuthenticator: NSObject {
    private var pending: CheckedContinuation<ASAuthorization, any Error>?
    private var controller: ASAuthorizationController?

    func register(_ options: PasskeyOptions) async throws -> Data {
        guard
            let rp = options.options.rp?.id,
            let user = options.options.user,
            let challenge = Data(base64URL: options.options.challenge),
            let userID = Data(base64URL: user.id)
        else { throw PasskeyError.badOptions }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rp)
        let request = provider.createCredentialRegistrationRequest(challenge: challenge, name: "fliq", userID: userID)
        guard let credential = try await perform(request).credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
              let attestation = credential.rawAttestationObject
        else { throw PasskeyError.failed("No passkey was created.") }

        return try Self.json(id: credential.credentialID, response: [
            "clientDataJSON": credential.rawClientDataJSON.base64URL,
            "attestationObject": attestation.base64URL,
            "transports": ["internal", "hybrid"],
        ])
    }

    func signIn(_ options: PasskeyOptions, relyingParty: String = "fliq.cash") async throws -> Data {
        guard let challenge = Data(base64URL: options.options.challenge) else { throw PasskeyError.badOptions }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: options.options.rp?.id ?? relyingParty)
        let request = provider.createCredentialAssertionRequest(challenge: challenge)
        guard let credential = try await perform(request).credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            throw PasskeyError.failed("No passkey was used.")
        }

        return try Self.json(id: credential.credentialID, response: [
            "clientDataJSON": credential.rawClientDataJSON.base64URL,
            "authenticatorData": credential.rawAuthenticatorData.base64URL,
            "signature": credential.signature.base64URL,
            "userHandle": credential.userID.base64URL,
        ])
    }

    private func perform(_ request: ASAuthorizationRequest) async throws -> ASAuthorization {
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.controller = controller
        defer { self.controller = nil }
        return try await withCheckedThrowingContinuation { continuation in
            pending = continuation
            controller.performRequests()
        }
    }

    private func finish(_ result: Result<ASAuthorization, any Error>) {
        pending?.resume(with: result)
        pending = nil
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
        let mapped: any Error = (error as? ASAuthorizationError)?.code == .canceled
            ? PasskeyError.cancelled
            : PasskeyError.failed(error.localizedDescription)
        MainActor.assumeIsolated { finish(.failure(mapped)) }
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
