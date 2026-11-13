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
                onExistingAccount: existingAccount,
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

    /// Spelled out as closures: Xcode 26.3 crashes type-checking `isLive ? nil : finish` inline.
    private var existingAccount: () -> Void {
        if isLive { return { usePasskey(.login) } }
        return { finish() }
    }

    private func start() {
        if isLive { return continueWithPasskey() }
        path.append(.claimName)
    }

    /// One button for everyone: signs in with the passkey this app recorded for its account, and creates the account
    /// when there is no record yet, or when the recorded passkey is no longer known to the server.
    private func continueWithPasskey() {
        guard !passkeyWorking else { return }
        passkeyWorking = true
        passkeyMessage = nil
        Task {
            defer { passkeyWorking = false }
            do {
                let known = memory.ids
                guard !known.isEmpty else { return try await createWithPasskey() }
                let options = try await api.passkeyOptions(.login)
                let response = try await passkeys.signIn(options, allowed: known)
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

    private func usePasskey(_ purpose: PasskeyPurpose) {
        guard !passkeyWorking else { return }
        passkeyWorking = true
        passkeyMessage = nil
        Task {
            defer { passkeyWorking = false }
            do {
                let options = try await api.passkeyOptions(purpose)
                let response = purpose == .register ? try await passkeys.register(options) : try await passkeys.signIn(options)
                let user = try await api.finishPasskey(purpose, challengeId: options.challengeId, credential: response)
                memory.remember(passkeys.lastCredentialID)
                signedIn(user)
            } catch PasskeyError.cancelled {
                return
            } catch {
                passkeyMessage = purpose == .register
                    ? "We couldn't create your passkey. Try again."
                    : "That passkey isn't for a fliq account here. Try another."
            }
        }
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
