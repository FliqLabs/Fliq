import SwiftUI

enum OnboardingStep: Hashable {
    case signIn, claimName, profile, ownAccount
}

/// Welcome, sign in when talking to the real API, claim a name, add a face, add your own account, then Home.
struct OnboardingView: View {
    private let profile: ProfileStore
    private let accounts: AccountBook
    private let isLive: Bool
    @State private var flow: OnboardingFlow
    @State private var signIn: SignInFlow
    @State private var path: [OnboardingStep] = []

    init(environment: AppEnvironment) {
        profile = environment.profile
        accounts = environment.accounts
        isLive = environment.isLive
        _flow = State(initialValue: OnboardingFlow(api: environment.api, names: environment.names, isLive: environment.isLive))
        _signIn = State(initialValue: SignInFlow(api: environment.api))
    }

    var body: some View {
        NavigationStack(path: $path) {
            WelcomeView(onStart: start, onExistingAccount: isLive ? start : finish, onSkip: isLive ? nil : finish)
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

    private func start() {
        path.append(isLive ? .signIn : .claimName)
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
