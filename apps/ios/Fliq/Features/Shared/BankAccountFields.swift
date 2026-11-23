import SwiftUI

/// Bank picker, account number and the bank's confirmation line, as on New account and Your account.
struct BankAccountFields: View {
    @Bindable var entry: AccountEntry
    @FocusState private var numberFocused: Bool
    @State private var pickingBank = false

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

    /// A list to search, not a menu to scroll: Nigeria alone has dozens of banks and wallets.
    private var bankPicker: some View {
        Button { pickingBank = true } label: {
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
            .contentShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .disabled(entry.institutions.isEmpty)
        .accessibilityLabel("Bank, \(entry.institution.name)")
        .accessibilityHint("Search for your bank")
        .sheet(isPresented: $pickingBank) {
            BankSearchSheet(institutions: entry.institutions, selected: entry.institution) { picked in
                entry.institution = picked
                pickingBank = false
                numberFocused = true
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            .presentationCornerRadius(32)
            .presentationBackground(Color(hex: 0x161616))
        }
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

/// Every bank and wallet for the country, searchable by name. The popular ones lead the list as the API sends them.
struct BankSearchSheet: View {
    let institutions: [Institution]
    let selected: Institution
    let onPick: (Institution) -> Void
    @State private var query = ""

    static func matches(_ institutions: [Institution], query: String) -> [Institution] {
        let words = query.lowercased().split(separator: " ").map(String.init)
        guard !words.isEmpty else { return institutions }
        return institutions.filter { institution in
            let name = institution.name.lowercased()
            return words.allSatisfy { name.contains($0) } || institution.code.lowercased() == query.lowercased()
        }
    }

    private var shown: [Institution] { Self.matches(institutions, query: query) }

    var body: some View {
        NavigationStack {
            List(shown, id: \.self) { institution in
                Button { onPick(institution) } label: {
                    HStack(spacing: 12) {
                        InstitutionLogo(logoKey: institution.logoKey, name: institution.name, size: 30)
                        Text(institution.name).foregroundStyle(Theme.textPrimary)
                        Spacer()
                        if institution == selected {
                            Icon("checkmark", size: 16).foregroundStyle(Theme.confirmed)
                        }
                    }
                    .font(.system(size: 17))
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .listRowBackground(Color.clear)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .overlay {
                if shown.isEmpty {
                    Text("No bank called \u{201C}\(query)\u{201D}. Check the spelling.")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search banks")
            .navigationTitle("Your bank")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
