import SwiftUI

struct NewAccountView: View {
    @Bindable var flow: PayFlow
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        VStack(spacing: 0) {
            CountryChips()
                .padding(.top, 28)

            BankAccountFields(entry: flow.recipient)
                .padding(.top, 28)

            Toggle("Save this account", isOn: $flow.saveAccount)
                .tint(Theme.confirmed)
                .font(.system(size: 16))
                .padding(.horizontal, 16)
                .frame(height: 54)
                .background(Theme.field, in: RoundedRectangle(cornerRadius: 12))
                .padding(.top, 28)

            Spacer()

            Button("Continue") { environment.router.push(.payAmount) }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(flow.verified == nil)
                .padding(.bottom, 12)
        }
        .fliqScreen("New account")
    }
}

struct CountryChips: View {
    var body: some View {
        HStack(spacing: 8) {
            Text("Nigeria")
                .foregroundStyle(.black)
                .padding(.horizontal, 16)
                .frame(height: 36)
                .background(.white, in: Capsule())
            Text("Kenya · soon")
                .foregroundStyle(Theme.textSecondary)
                .padding(.horizontal, 16)
                .frame(height: 36)
                .background(Theme.field, in: Capsule())
        }
        .font(.system(size: 14, weight: .medium))
    }
}

#Preview {
    NavigationStack {
        NewAccountView(flow: PayFlow(api: FixtureClient()))
    }
    .environment(AppEnvironment.preview)
}
