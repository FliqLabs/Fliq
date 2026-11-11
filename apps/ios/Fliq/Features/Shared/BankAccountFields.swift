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
            entry.number = String(entry.number.filter(\.isNumber).prefix(entry.maxLength))
            if entry.checksOnLastDigit { numberFocused = false }
        }
        .task(id: "\(entry.institution.code)-\(entry.number)") {
            guard entry.isComplete, entry.verified == nil else { return }
            if !entry.checksOnLastDigit { try? await Task.sleep(for: .milliseconds(800)) }
            guard !Task.isCancelled else { return }
            await entry.verify()
        }
    }

    private var bankPicker: some View {
        Menu {
            Picker("Bank", selection: $entry.institution) {
                ForEach(entry.institutions, id: \.self) { Text($0.name).tag($0) }
            }
        } label: {
            HStack(spacing: 12) {
                InstitutionLogo(logoKey: entry.institution.logoKey, name: entry.institution.name, size: 30)
                Text(entry.institution.name)
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                Icon("chevron.down", size: 17)
                    .foregroundStyle(Theme.textTertiary)
            }
            .font(.system(size: 17))
            .padding(.horizontal, 16)
            .frame(height: 64)
            .background(Theme.field, in: RoundedRectangle(cornerRadius: 14))
        }
        .disabled(entry.institutions.isEmpty)
    }

    private var numberField: some View {
        HStack {
            TextField(entry.institution.type == .mobileMoney ? "Phone number" : "Account number", text: $entry.number)
                .keyboardType(.numberPad)
                .focused($numberFocused)
                .font(.system(size: 22, weight: .medium).monospacedDigit())
                .tracking(2.5)
            Text("\(entry.number.count)/\(entry.maxLength)")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textTertiary)
        }
        .padding(.horizontal, 20)
        .frame(height: 64)
        .background(Theme.field, in: RoundedRectangle(cornerRadius: 14))
        .overlay {
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(entry.verified == nil ? .clear : Theme.confirmed)
        }
    }

    @ViewBuilder
    private var confirmation: some View {
        Group {
            if let verified = entry.verified {
                HStack(spacing: 6) {
                    Icon("checkmark.circle", size: 18)
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
