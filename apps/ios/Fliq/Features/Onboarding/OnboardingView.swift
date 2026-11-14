import SwiftUI

enum OnboardingStep: Hashable {
    case claimName, profile, ownAccount
}

/// Welcome, a passkey when talking to the real API, claim a name, add a face, add your own account, then Home.
struct OnboardingView: View {
    private let profile: ProfileStore
    private let accounts: AccountBook
    private let isLive: Bool
    private let api: any FliqAPI
    @State private var passkeys = PasskeyAuthenticator()
    @State private var passkeyWorking = false
    @State private var passkeyMessage: String?
    private let memory = PasskeyMemory()
    @State private var flow: OnboardingFlow
    @State private var path: [OnboardingStep] = []

    init(environment: AppEnvironment) {
        profile = environment.profile
        accounts = environment.accounts
        isLive = environment.isLive
        api = environment.api
        _flow = State(initialValue: OnboardingFlow(api: environment.api, names: environment.names, isLive: environment.isLive, photos: environment.photos))
    }

    var body: some View {
        NavigationStack(path: $path) {
            WelcomeView(
                onStart: start,
                isWorking: passkeyWorking,
                message: passkeyMessage
            )
            .navigationDestination(for: OnboardingStep.self, destination: screen)
        }
        .tint(Theme.textPrimary)
    }

    @ViewBuilder
    private func screen(_ step: OnboardingStep) -> some View {
        switch step {
        case .claimName:
            ClaimNameView(flow: flow, onContinue: claim)
        case .profile:
            ProfileSetupView(flow: flow, onContinue: { path.append(.ownAccount) })
        case .ownAccount:
            YourAccountView(entry: flow.ownAccount, onDone: finish)
        }
    }

    private func start() {
        if isLive { return continueWithPasskey() }
        path.append(.claimName)
    }

    /// One button for everyone. It signs in with the passkey this app recorded, or with any fliq passkey already on
    /// this iPhone, and creates the account when there is none or the server no longer knows the one offered.
    private func continueWithPasskey() {
        guard !passkeyWorking else { return }
        passkeyWorking = true
        passkeyMessage = nil
        Task {
            defer { passkeyWorking = false }
            do {
                let known = memory.ids
                let options = try await api.passkeyOptions(.login)
                let response: Data
                do {
                    response = try await passkeys.signIn(options, allowed: known, onlyIfOnThisDevice: known.isEmpty)
                } catch PasskeyError.cancelled where known.isEmpty {
                    return try await createWithPasskey()
                }
                do {
                    let user = try await api.finishPasskey(.login, challengeId: options.challengeId, credential: response)
                    memory.remember(passkeys.lastCredentialID)
                    signedIn(user)
                } catch let error as APIError where Self.isRejectedPasskey(error) {
                    memory.forget()
                    try await createWithPasskey()
                }
            } catch {
                couldNotCreate(error)
            }
        }
    }

    /// The API answers a passkey it has no account for with 401 "Unknown passkey".
    static func isRejectedPasskey(_ error: APIError) -> Bool {
        switch error {
        case .server(let status, _), .unexpected(let status): (400..<500).contains(status)
        case .refused: false
        }
    }

    private func createWithPasskey() async throws {
        let options = try await api.passkeyOptions(.register)
        let response = try await passkeys.register(options)
        let user = try await api.finishPasskey(.register, challengeId: options.challengeId, credential: response)
        memory.remember(passkeys.lastCredentialID)
        signedIn(user)
    }

    private func couldNotCreate(_ error: any Error) {
        if case PasskeyError.cancelled = error { return }
        passkeyMessage = "We couldn't create your passkey. Try again."
    }

    /// A returning user already has a name and goes straight to Home.
    private func signedIn(_ user: User) {
        guard let account = user.nearAccount else { return path.append(.claimName) }
        profile.completeOnboarding(account: account, displayName: user.displayName)
    }

    private func claim() {
        Task { if await flow.claim() { path.append(.profile) } }
    }

    private func finish() {
        if let own = flow.ownAccount.verified { accounts.setOwn(own) }
        Task {
            await flow.saveProfile()
            let name = flow.claimed ?? (flow.canClaim ? flow.name?.account : nil)
            profile.completeOnboarding(account: name, displayName: flow.displayName)
        }
    }
}
