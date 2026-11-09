import SwiftUI

struct WelcomeView: View {
    let onStart: () -> Void
    let onExistingAccount: () -> Void
    var onSkip: (() -> Void)? = nil
    var isWorking = false
    var message: String?
    var onEmail: (() -> Void)?

    private static let accent = LinearGradient(
        colors: [Color(hex: 0x7B61FF), Color(hex: 0xB39BFF)],
        startPoint: .leading,
        endPoint: .trailing
    )

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(alignment: .leading, spacing: 18) {
                (Text("Money without\n") + Text("borders").foregroundStyle(Self.accent) + Text("."))
                    .font(.system(size: 38, weight: .bold))
                    .tracking(-1)
                    .lineSpacing(2)
                Text("Any chain. Any bank or mobile money.\nBest live rates, in seconds.")
                    .font(.system(size: 16))
                    .foregroundStyle(Color(hex: 0xC9CCE0))
                    .lineSpacing(4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.bottom, 44)

            VStack(spacing: 22) {
                Button(action: onStart) {
                    HStack(spacing: 12) {
                        if isWorking {
                            ProgressView().tint(.black)
                        } else {
                            icon("IconPasskey")
                        }
                        Text("Continue with passkey")
                    }
                    .frame(maxWidth: .infinity)
                    .overlay(alignment: .trailing) {
                        Image(systemName: "arrow.right")
                            .font(.system(size: 17, weight: .semibold))
                            .padding(.trailing, 26)
                    }
                }
                .buttonStyle(WelcomeButtonStyle())
                .disabled(isWorking)
                Button(action: onExistingAccount) {
                    HStack(spacing: 10) {
                        icon("IconDownload")
                        Text("I already have an account")
                    }
                    .font(.system(size: 17, weight: .medium))
                }
                .foregroundStyle(Theme.textPrimary)
                .disabled(isWorking)
                if let message {
                    Text(message)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.danger)
                        .multilineTextAlignment(.center)
                }
                if let onEmail {
                    Button("Use email instead", action: onEmail)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color(hex: 0x8E8E8E))
                }
            }
            .padding(.bottom, 36)
        }
        .padding(.horizontal, 26)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay(alignment: .topTrailing) {
            if let onSkip {
                Button("Skip", action: onSkip)
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.trailing, 24)
                    .padding(.top, 12)
            }
        }
        .background {
            Image("WelcomeBackground")
                .resizable()
                .scaledToFill()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
                .background(Color.black)
                .ignoresSafeArea()
                .accessibilityHidden(true)
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    private func icon(_ name: String) -> some View {
        Image(name)
            .resizable()
            .renderingMode(.template)
            .frame(width: 20, height: 20)
    }
}

/// The Welcome screen's white pill, lit from below by the artwork.
private struct WelcomeButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(Color(hex: 0x0B0B14))
            .frame(maxWidth: .infinity, minHeight: 56)
            .background {
                Capsule().fill(
                    LinearGradient(colors: [.white, Color(hex: 0xEEEAFF)], startPoint: .top, endPoint: .bottom)
                )
            }
            .shadow(color: Color(hex: 0x8B6CFF).opacity(0.45), radius: 18, y: 8)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.65), value: configuration.isPressed)
            .sensoryFeedback(.impact(weight: .light), trigger: configuration.isPressed) { _, pressed in pressed }
    }
}

#Preview {
    WelcomeView(onStart: {}, onExistingAccount: {}, onSkip: {})
}
