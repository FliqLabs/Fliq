import SwiftUI

/// Bank picker, account number and the bank's confirmation line, as on New account and Your account.
struct BankAccountFields: View {
    @Bindable var entry: AccountEntry
    @FocusState private var numberFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            bankPicker
            numberField
            confirmation
        }
        .onAppear { numberFocused = true }
        .task { await entry.loadInstitutions() }
        .onChange(of: entry.number) {
            entry.number = String(entry.number.filter(\.isNumber).prefix(AccountEntry.numberLength))
            if entry.isComplete {
                numberFocused = false
                Task { await entry.verify() }
            }
        }
    }

    private var bankPicker: some View {
        Menu {
            Picker("Bank", selection: $entry.institution) {
                ForEach(entry.institutions, id: \.self) { Text($0.name).tag($0) }
            }
        } label: {
            HStack {
                Image(systemName: "building.columns")
                    .foregroundStyle(Theme.textSecondary)
                Text(entry.institution.name)
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                Image(systemName: "chevron.down")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textTertiary)
            }
            .font(.system(size: 16))
            .padding(.horizontal, 16)
            .frame(height: 54)
            .background(Theme.field, in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private var numberField: some View {
        HStack {
            TextField("Account number", text: $entry.number)
                .keyboardType(.numberPad)
                .focused($numberFocused)
                .font(.system(size: 18).monospacedDigit())
                .tracking(1)
            Text("\(entry.number.count)/\(AccountEntry.numberLength)")
                .font(.system(size: 12))
                .foregroundStyle(Theme.textTertiary)
        }
        .padding(.horizontal, 16)
        .frame(height: 54)
        .background(Theme.field, in: RoundedRectangle(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(entry.verified == nil ? .clear : Theme.confirmed)
        }
    }

    @ViewBuilder
    private var confirmation: some View {
        Group {
            if let verified = entry.verified {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle")
                    Text(verified.accountName).fontWeight(.semibold)
                    Text("· confirmed by \(verified.institution)").foregroundStyle(Theme.textTertiary)
                }
                .foregroundStyle(Theme.confirmed)
            } else if entry.isVerifying {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.mini)
                    Text("Checking with \(entry.institution.name)")
                }
                .foregroundStyle(Theme.textSecondary)
            } else if let message = entry.errorMessage {
                Text(message).foregroundStyle(Theme.warning)
            }
        }
        .font(.system(size: 13))
        .padding(.horizontal, 4)
    }
}
