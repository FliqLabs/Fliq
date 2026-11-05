import SwiftUI

struct SignInView: View {
    @Bindable var flow: SignInFlow
    let onSignedIn: (User) -> Void
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 6) {
                Text(flow.stage == .email ? "Sign in with email" : "Check your email")
                    .font(.system(size: 26, weight: .bold))
                    .tracking(-0.52)
                Text(subtitle)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 36)

            field
                .padding(.top, 34)

            if let error = flow.errorMessage {
                Text(error)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.danger)
                    .multilineTextAlignment(.center)
                    .padding(.top, 16)
            }

            if flow.stage != .email {
                Button("Use a different email", action: flow.restart)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.top, 18)
            }

            Spacer()

            HStack {
                Spacer()
                Button(action: submit) {
                    ChipLabel(text: action, symbol: "chevron.right", color: canSubmit ? Theme.confirmed : Theme.textTertiary)
                }
                .disabled(!canSubmit)
            }
            .padding(.bottom, 14)
        }
        .fliqScreen(ground: Theme.onboardingGround)
        .onAppear { focused = true }
        .onOpenURL { url in Task { await flow.verify(url.absoluteString) } }
        .onChange(of: flow.user) { if let user = flow.user { onSignedIn(user) } }
    }

    private var field: some View {
        Group {
            if flow.stage == .email {
                TextField("you@example.com", text: $flow.email)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .submitLabel(.send)
                    .accessibilityLabel("Email")
            } else {
                TextField("Paste the link from the email", text: $flow.link)
                    .submitLabel(.go)
                    .accessibilityLabel("Sign-in link")
            }
        }
        .font(.system(size: 17, weight: .semibold))
        .focused($focused)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .onSubmit(submit)
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, minHeight: 64)
        .background(Color.white.opacity(0.06), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.12)))
    }

    private var subtitle: String {
        flow.stage == .email
            ? "We'll send you a one-time link. No password."
            : "Tap the link we sent to \(flow.email), or paste it here."
    }

    private var action: String {
        switch flow.stage {
        case .email: flow.isSending ? "Sending…" : "Send link"
        case .sent: "Sign in"
        case .verifying: "Signing in…"
        }
    }

    private var canSubmit: Bool {
        switch flow.stage {
        case .email: flow.canSend
        case .sent: SignInFlow.token(in: flow.link) != nil
        case .verifying: false
        }
    }

    private func submit() {
        guard canSubmit else { return }
        Task { flow.stage == .email ? await flow.send() : await flow.verify() }
    }
}
