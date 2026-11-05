import Foundation

/// A business workspace from the dashboard API. The iPhone app only reads these, so the
/// API's enums (use case, countries, key environment) stay as text.
struct Workspace: Codable, Sendable, Equatable {
    let workspaceId: String
    let name: String
    let useCase: String
    let countries: [String]
    let liveEnabled: Bool
}

struct SandboxKey: Codable, Sendable, Equatable {
    let keyId: String
    let key: String
}

struct WorkspaceCreated: Codable, Sendable, Equatable {
    let workspace: Workspace
    let sandboxKey: SandboxKey
}

struct APIKeyView: Codable, Sendable, Equatable {
    let keyId: String
    let environment: String
    let masked: String
    let createdAt: Date
}

struct KeyList: Codable, Sendable, Equatable {
    let items: [APIKeyView]
}

/// The API's first-login checklist (`GET /onboarding`). Named so it doesn't clash with the
/// app's own onboarding screens.
struct OnboardingChecklist: Codable, Sendable, Equatable {
    struct Step: Codable, Sendable, Equatable {
        let id: String
        let done: Bool
    }

    let steps: [Step]
}
