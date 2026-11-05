import SwiftUI

enum OnboardingStep: Hashable {
    case signIn, claimName, profile, ownAccount
}

/// Welcome, a passkey (or email) when talking to the real API, claim a name, add a face, add your own account, then Home.
struct OnboardingView: View {
    private let profile: ProfileStore
    private let accounts: AccountBook
    private let isLive: Bool
    private let api: any FliqAPI
    @State private var passkeys = PasskeyAuthenticator()
    @State private var passkeyWorking = false
    @State private var passkeyMessage: String?
    @State private var flow: OnboardingFlow
    @State private var signIn: SignInFlow
    @State private var path: [OnboardingStep] = []

    init(environment: AppEnvironment) {
        profile = environment.profile
        accounts = environment.accounts
        isLive = environment.isLive
        api = environment.api
        _flow = State(initialValue: OnboardingFlow(api: environment.api, names: environment.names, isLive: environment.isLive))
        _signIn = State(initialValue: SignInFlow(api: environment.api))
    }

    var body: some View {
        NavigationStack(path: $path) {
            WelcomeView(
                onStart: { isLive ? usePasskey(.register) : path.append(.claimName) },
                onExistingAccount: { isLive ? usePasskey(.login) : finish() },
                isWorking: passkeyWorking,
                message: passkeyMessage,
                onEmail: isLive ? { path.append(.signIn) } : nil
            )
                .navigationDestination(for: OnboardingStep.self, destination: screen)
        }
        .tint(Theme.textPrimary)
    }

    @ViewBuilder
    private func screen(_ step: OnboardingStep) -> some View {
        switch step {
        case .signIn:
            SignInView(flow: signIn, onSignedIn: signedIn)
        case .claimName:
            ClaimNameView(flow: flow, onContinue: claim, onSkip: { path.append(.ownAccount) })
        case .profile:
            ProfileSetupView(flow: flow, onContinue: { path.append(.ownAccount) })
        case .ownAccount:
            YourAccountView(entry: flow.ownAccount, onDone: finish)
        }
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
                signedIn(try await api.finishPasskey(purpose, challengeId: options.challengeId, credential: response))
            } catch PasskeyError.cancelled {
                return
            } catch {
                passkeyMessage = purpose == .register
                    ? "We couldn't create your passkey. Try again or use email."
                    : "We couldn't sign you in with a passkey. Try again or use email."
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
