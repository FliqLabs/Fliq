import SwiftUI

struct WelcomeView: View {
    let onStart: () -> Void
    let onExistingAccount: () -> Void
    var onSkip: (() -> Void)? = nil
    var isWorking = false
    var message: String?
    var onEmail: (() -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()
            Image("FliqMark")
                .resizable()
                .frame(width: 52, height: 52)
                .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).strokeBorder(.white.opacity(0.14)))
                .accessibilityHidden(true)
            Text("Money without\nborders")
                .font(.system(size: 36, weight: .medium))
                .tracking(-0.8)
                .foregroundStyle(Theme.textPrimary)
                .padding(.top, 26)
            Text("Any chain. Any bank or mobile money.\nBest live rates, in seconds.")
                .font(.system(size: 16))
                .foregroundStyle(Theme.textSecondary)
                .lineSpacing(5)
                .padding(.top, 16)

            VStack(spacing: 12) {
                Button(action: onStart) {
                    HStack(spacing: 12) {
                        if isWorking {
                            ProgressView().tint(.black)
                        } else {
                            Image("IconPasskey")
                                .resizable()
                                .renderingMode(.template)
                                .frame(width: 20, height: 20)
                        }
                        Text("Continue with passkey")
                    }
                }
                .buttonStyle(WelcomeButtonStyle(isPrimary: true))
                Button(action: onExistingAccount) {
                    HStack(spacing: 12) {
                        Icon("arrow.counterclockwise", size: 20)
                        Text("I already have an account")
                    }
                }
                .buttonStyle(WelcomeButtonStyle(isPrimary: false))
            }
            .disabled(isWorking)
            .padding(.top, 34)

            VStack(spacing: 12) {
                if let message {
                    Text(message)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.danger)
                        .multilineTextAlignment(.center)
                }
                if let onEmail {
                    Button("Use email instead", action: onEmail)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(minHeight: 44)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
        }
        .padding(.horizontal, 26)
        .padding(.bottom, 12)
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
        .background { backdrop }
        .toolbar(.hidden, for: .navigationBar)
    }

    /// The film fills the top of the screen and fades into black behind the words and buttons.
    private var backdrop: some View {
        GeometryReader { proxy in
            LoopingVideo(resource: "Welcome", plays: !reduceMotion)
                .frame(width: proxy.size.width, height: proxy.size.height * 0.62)
                .clipped()
                .overlay {
                    LinearGradient(
                        stops: [
                            .init(color: .black.opacity(0.25), location: 0),
                            .init(color: .black.opacity(0.1), location: 0.45),
                            .init(color: .black, location: 1),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                }
        }
        .background(Color.black)
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

/// The Welcome screen's two pills: white for the main action, glass for the other.
private struct WelcomeButtonStyle: ButtonStyle {
    let isPrimary: Bool

    func makeBody(configuration: Configuration) -> some View {
        label(configuration)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.65), value: configuration.isPressed)
            .sensoryFeedback(.impact(weight: .light), trigger: configuration.isPressed) { _, pressed in pressed }
    }

    @ViewBuilder
    private func label(_ configuration: Configuration) -> some View {
        let label = configuration.label
            .font(.system(size: 17, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 58)
            .contentShape(Capsule())
        if isPrimary {
            label.foregroundStyle(Color(hex: 0x0B0B14)).background(.white, in: Capsule())
        } else {
            label.foregroundStyle(Theme.textPrimary).fliqGlass(Capsule(), interactive: true)
        }
    }
}

#Preview {
    WelcomeView(onStart: {}, onExistingAccount: {}, onSkip: {})
}
