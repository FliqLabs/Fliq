import SwiftUI

/// Settings, Add account: confirm an account with the bank and save it. Nothing is paid.
/// With no account of your own yet, the first one saved becomes yours.
struct AddAccountView: View {
    @State private var entry: AccountEntry
    let onSave: (VerifiedAccount) -> Void

    init(api: any FliqAPI, onSave: @escaping (VerifiedAccount) -> Void) {
        _entry = State(initialValue: AccountEntry(api: api))
        self.onSave = onSave
    }

    var body: some View {
        VStack(spacing: 0) {
            CountryChips(selected: entry.country) { country in
                Task { await entry.choose(country) }
            }
            .padding(.top, 28)

            BankAccountFields(entry: entry)
                .padding(.top, 28)

            Spacer()

            Button("Save account") {
                if let verified = entry.verified { onSave(verified) }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(entry.verified == nil)
            .padding(.bottom, 12)
        }
        .fliqScreen("Add account")
        .task { await entry.loadInstitutions() }
    }
}
