import SwiftUI

struct WelcomeView: View {
    let onStart: () -> Void
    let onExistingAccount: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Wordmark(size: 32)
                .padding(.top, 24)
            Spacer()
            VStack(spacing: 14) {
                Text("Dollars in,\nyour bank account out\(Text(".").foregroundStyle(Color(hex: 0x8E8E8E)))")
                    .font(.system(size: 36, weight: .bold))
                    .tracking(-1)
                    .multilineTextAlignment(.center)
                Text("Global crypto. Local money.")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color(hex: 0xE5E5E5))
                Text("Any chain, any bank or mobile money.\nThe best live rate, in your account in seconds.")
                    .font(.system(size: 14))
                    .foregroundStyle(Color(hex: 0x8E8E8E))
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
            }
            .padding(.bottom, 84)

            VStack(spacing: 18) {
                Button(action: onStart) {
                    Label("Continue with passkey", systemImage: "person.badge.key")
                }
                .buttonStyle(PrimaryButtonStyle())
                Button(action: onExistingAccount) {
                    Label("I already have an account", systemImage: "arrow.down.to.line")
                        .font(.system(size: 15, weight: .medium))
                }
                .foregroundStyle(Theme.textPrimary)
            }
            .padding(.bottom, 20)
        }
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            ZStack {
                Color.black
                Aurora()
            }
            .ignoresSafeArea()
        }
        .toolbar(.hidden, for: .navigationBar)
    }
}

#Preview {
    WelcomeView(onStart: {}, onExistingAccount: {})
}
