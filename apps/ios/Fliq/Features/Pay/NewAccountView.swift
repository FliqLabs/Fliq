import SwiftUI

struct NewAccountView: View {
    @Bindable var flow: PayFlow
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        VStack(spacing: 0) {
            CountryChips(selected: flow.recipient.country) { country in
                Task { await flow.recipient.choose(country) }
            }
            .padding(.top, 28)

            BankAccountFields(entry: flow.recipient)
                .padding(.top, 28)

            Toggle("Save this account", isOn: $flow.saveAccount)
                .tint(Theme.confirmed)
                .font(.system(size: 17))
                .padding(.horizontal, 16)
                .frame(height: 64)
                .background(Theme.field, in: RoundedRectangle(cornerRadius: 14))
                .padding(.top, 36)

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
    let selected: Country
    let onSelect: (Country) -> Void

    var body: some View {
        HStack(spacing: 8) {
            ForEach(Country.allCases, id: \.self) { country in
                Button { onSelect(country) } label: {
                    HStack(spacing: 8) {
                        CountryFlag(country: country)
                        Text(country.name)
                    }
                    .foregroundStyle(country == selected ? .black : Theme.textSecondary)
                    .padding(.leading, 12)
                    .padding(.trailing, 16)
                    .frame(height: 40)
                    .background(country == selected ? Color.white : Theme.field, in: Capsule())
                }
            }
        }
        .font(.system(size: 16, weight: .medium))
    }
}

#Preview {
    NavigationStack {
        NewAccountView(flow: PayFlow(api: FixtureClient()))
    }
    .environment(AppEnvironment.preview)
}
