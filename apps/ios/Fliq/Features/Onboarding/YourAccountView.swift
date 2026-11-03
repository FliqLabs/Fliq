import SwiftUI

struct YourAccountView: View {
    let entry: AccountEntry
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 12) {
                Text("Where should your\nmoney land?")
                    .font(.system(size: 32, weight: .bold))
                    .tracking(-1)
                    .multilineTextAlignment(.center)
                Text("Add your own account once.\nCashing out becomes one tap.")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 40)

            VStack(spacing: 10) {
                HStack {
                    Text("Nigeria").font(.system(size: 16))
                    Spacer()
                    Text("Kenya soon")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textTertiary)
                }
                .padding(.horizontal, 16)
                .frame(height: 54)
                .background(Theme.field, in: RoundedRectangle(cornerRadius: 12))

                BankAccountFields(entry: entry)
            }
            .padding(.top, 32)

            Spacer()

            Button("Continue", action: onDone)
                .buttonStyle(PrimaryButtonStyle())
                .disabled(entry.verified == nil)
            Button("Not now", action: onDone)
                .font(.system(size: 15))
                .foregroundStyle(Theme.textSecondary)
                .frame(height: 40)
                .padding(.top, 14)
                .padding(.bottom, 8)
        }
        .fliqScreen()
    }
}
