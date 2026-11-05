import SwiftUI

struct WelcomeView: View {
    let onStart: () -> Void
    let onExistingAccount: () -> Void
    var onSkip: (() -> Void)? = nil

    private static let accent = LinearGradient(
        colors: [Color(hex: 0x4D7CFF), Color(hex: 0x5EDCFF), Color(hex: 0x9B6CFF)],
        startPoint: .leading,
        endPoint: .trailing
    )

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(alignment: .leading, spacing: 20) {
                (Text("Dollars in,\nyour bank account ") + Text("out.").foregroundStyle(Self.accent))
                    .font(.system(size: 34, weight: .bold))
                    .tracking(-0.8)
                    .lineSpacing(2)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Any chain. Any bank or mobile money.")
                        .font(.system(size: 16, weight: .semibold))
                    Text("Move money globally at the best live rate, in seconds.")
                        .font(.system(size: 15))
                        .foregroundStyle(Color(hex: 0xA9ACC7))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.bottom, 32)

            VStack(spacing: 20) {
                Button(action: onStart) {
                    HStack(spacing: 12) {
                        icon("IconPasskey")
                        Text("Continue with passkey")
                    }
                }
                .buttonStyle(WelcomeButtonStyle())
                Button(action: onExistingAccount) {
                    HStack(spacing: 10) {
                        icon("IconDownload")
                        Text("I already have an account")
                    }
                    .font(.system(size: 17, weight: .semibold))
                }
                .foregroundStyle(Theme.textPrimary)
            }
            .padding(.bottom, 24)
        }
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay(alignment: .topTrailing) {
            if let onSkip {
                Button("Skip", action: onSkip)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.trailing, 24)
                    .padding(.top, 8)
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
            .frame(maxWidth: .infinity, minHeight: 52)
            .background {
                Capsule().fill(
                    LinearGradient(colors: [.white, Color(hex: 0xECE8FF)], startPoint: .top, endPoint: .bottom)
                )
            }
            .shadow(color: Color(hex: 0x8B6CFF).opacity(0.55), radius: 18, y: 8)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.65), value: configuration.isPressed)
            .sensoryFeedback(.impact(weight: .light), trigger: configuration.isPressed) { _, pressed in pressed }
    }
}

#Preview {
    WelcomeView(onStart: {}, onExistingAccount: {}, onSkip: {})
}
