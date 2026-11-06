import SwiftUI

struct WelcomeView: View {
    let onStart: () -> Void
    let onExistingAccount: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 14) {
                Text("Dollars in,\nyour bank account out\(Text(".").foregroundStyle(Color(hex: 0x8E8E8E)))")
                    .font(.system(size: 36, weight: .bold))
                    .tracking(-1.08)
                    .multilineTextAlignment(.center)
                Text("Global crypto. Local money.")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color(hex: 0xE5E5E5))
                Text("Any chain, any bank or mobile money.\nThe best live rate, in your account in seconds.")
                    .font(.system(size: 14))
                    .foregroundStyle(Color(hex: 0x8E8E8E))
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                    .padding(.top, -8)
            }
            .padding(.bottom, 84)

            VStack(spacing: 18) {
                Button(action: onStart) {
                    HStack(spacing: 10) {
                        icon("IconPasskey")
                        Text("Continue with passkey")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                Button(action: onExistingAccount) {
                    HStack(spacing: 8) {
                        icon("IconDownload")
                        Text("I already have an account")
                    }
                    .font(.system(size: 15, weight: .medium))
                }
                .foregroundStyle(Theme.textPrimary)
            }
            .padding(.bottom, 10)
        }
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            Image("WelcomeBackground")
                .resizable()
                .scaledToFill()
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
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
            .frame(width: 18, height: 18)
    }
}

#Preview {
    WelcomeView(onStart: {}, onExistingAccount: {})
}
