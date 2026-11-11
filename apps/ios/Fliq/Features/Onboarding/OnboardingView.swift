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
    @State private var offerNewAccount = false
    @State private var flow: OnboardingFlow
    @State private var signIn: SignInFlow
    @State private var path: [OnboardingStep] = []

    init(environment: AppEnvironment) {
        profile = environment.profile
        accounts = environment.accounts
        isLive = environment.isLive
        api = environment.api
        _flow = State(initialValue: OnboardingFlow(api: environment.api, names: environment.names, isLive: environment.isLive, photos: environment.photos))
        _signIn = State(initialValue: SignInFlow(api: environment.api))
    }

    var body: some View {
        NavigationStack(path: $path) {
            WelcomeView(
                onStart: start,
                onExistingAccount: existingAccount,
                onSkip: skip,
                isWorking: passkeyWorking,
                message: passkeyMessage,
                onEmail: email,
                onCreateAccount: offerNewAccount ? { createAccount() } : nil
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

    /// Spelled out as closures: Xcode 26.3 crashes type-checking `isLive ? nil : finish` inline.
    private var existingAccount: () -> Void {
        if isLive { return { usePasskey(.login) } }
        return { finish() }
    }

    /// The demo build can skip to Home. The live build cannot.
    private var skip: (() -> Void)? {
        if isLive { return nil }
        return { finish() }
    }

    /// The live build offers email when a passkey is not an option.
    private var email: (() -> Void)? {
        if isLive { return { path.append(.signIn) } }
        return nil
    }

    private func start() {
        if isLive { return continueWithPasskey() }
        path.append(.claimName)
    }

    /// Signs in with a passkey this iPhone already holds and creates an account only when there is none. A passkey this
    /// server does not know (a testnet one in the mainnet app) gets a message and a Create a new account button.
    private func continueWithPasskey() {
        guard !passkeyWorking else { return }
        passkeyWorking = true
        passkeyMessage = nil
        offerNewAccount = false
        Task {
            defer { passkeyWorking = false }
            do {
                let options = try await api.passkeyOptions(.login)
                let response = try await passkeys.signIn(options, onlySaved: true)
                do {
                    return signedIn(try await api.finishPasskey(.login, challengeId: options.challengeId, credential: response))
                } catch let error as APIError where Self.isRejectedPasskey(error) {
                    passkeyMessage = "That passkey isn't for a fliq account here. Pick the one named \(PasskeyAuthenticator.label), or create a new account."
                    offerNewAccount = true
                }
            } catch PasskeyError.noneSaved {
                do { try await createWithPasskey() } catch { couldNotCreate(error) }
            } catch PasskeyError.cancelled {
                return
            } catch {
                couldNotCreate(error)
            }
        }
    }

    /// The API answers a passkey it has no account for with 401 "Unknown passkey", whose body may not decode.
    static func isRejectedPasskey(_ error: APIError) -> Bool {
        switch error {
        case .server(let status, _), .unexpected(let status): (400..<500).contains(status)
        case .refused: false
        }
    }

    private func createAccount() {
        guard !passkeyWorking else { return }
        passkeyWorking = true
        passkeyMessage = nil
        offerNewAccount = false
        Task {
            defer { passkeyWorking = false }
            do { try await createWithPasskey() } catch { couldNotCreate(error) }
        }
    }

    private func createWithPasskey() async throws {
        let options = try await api.passkeyOptions(.register)
        let response = try await passkeys.register(options)
        signedIn(try await api.finishPasskey(.register, challengeId: options.challengeId, credential: response))
    }

    private func couldNotCreate(_ error: any Error) {
        if case PasskeyError.cancelled = error { return }
        passkeyMessage = "We couldn't create your passkey. Try again or use email."
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
