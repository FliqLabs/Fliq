import SwiftUI

enum OnboardingStep: Hashable {
    case claimName, profile, ownAccount
}

/// Welcome, claim a name, add a face, add your own account, then Home.
struct OnboardingView: View {
    private let profile: ProfileStore
    private let accounts: AccountBook
    @State private var flow: OnboardingFlow
    @State private var path: [OnboardingStep] = []

    init(environment: AppEnvironment) {
        profile = environment.profile
        accounts = environment.accounts
        _flow = State(initialValue: OnboardingFlow(api: environment.api, names: environment.names))
    }

    var body: some View {
        NavigationStack(path: $path) {
            WelcomeView(onStart: { path.append(.claimName) }, onExistingAccount: finish)
                .navigationDestination(for: OnboardingStep.self, destination: screen)
        }
        .tint(Theme.textPrimary)
    }

    @ViewBuilder
    private func screen(_ step: OnboardingStep) -> some View {
        switch step {
        case .claimName:
            ClaimNameView(flow: flow, onContinue: { path.append(.profile) }, onSkip: { path.append(.ownAccount) })
        case .profile:
            ProfileSetupView(flow: flow, onContinue: { path.append(.ownAccount) })
        case .ownAccount:
            YourAccountView(entry: flow.ownAccount, onDone: finish)
        }
    }

    private func finish() {
        if let own = flow.ownAccount.verified { accounts.setOwn(own) }
        profile.completeOnboarding(name: flow.canClaim ? flow.name : nil, displayName: flow.displayName)
    }
}
