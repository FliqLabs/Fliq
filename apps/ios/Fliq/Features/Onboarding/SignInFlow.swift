import Foundation
import Observation

/// Email sign-in: send a one-time link, then open it or paste it here.
@MainActor
@Observable
final class SignInFlow {
    enum Stage: Equatable {
        case email, sent, verifying
    }

    var email = ""
    var link = ""
    private(set) var stage = Stage.email
    private(set) var isSending = false
    private(set) var errorMessage: String?
    private(set) var user: User?

    private let api: any FliqAPI

    init(api: any FliqAPI) {
        self.api = api
    }

    var canSend: Bool {
        let parts = email.trimmingCharacters(in: .whitespaces).split(separator: "@")
        return parts.count == 2 && parts[1].contains(".") && !isSending
    }

    func send() async {
        guard canSend else { return }
        isSending = true
        defer { isSending = false }
        do {
            _ = try await api.sendEmailLink(to: email.trimmingCharacters(in: .whitespaces))
            errorMessage = nil
            stage = .sent
        } catch {
            errorMessage = "We couldn't send the link. Check the address and try again."
        }
    }

    /// Accepts the whole link from the email, a `fliq://auth/verify?token=` link, or the bare token.
    func verify(_ text: String? = nil) async {
        guard let token = Self.token(in: text ?? link) else {
            errorMessage = "That doesn't look like a fliq sign-in link."
            return
        }
        stage = .verifying
        do {
            user = try await api.verifyEmailLink(token: token)
            errorMessage = nil
        } catch {
            stage = .sent
            errorMessage = "This link has expired or was already used. Send a new one."
        }
    }

    func restart() {
        stage = .email
        link = ""
        errorMessage = nil
    }

    nonisolated static func token(in text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let components = URLComponents(string: trimmed),
           let token = components.queryItems?.first(where: { $0.name == "token" })?.value, !token.isEmpty {
            return token
        }
        return trimmed.hasPrefix("el_") && !trimmed.contains(" ") ? trimmed : nil
    }
}
