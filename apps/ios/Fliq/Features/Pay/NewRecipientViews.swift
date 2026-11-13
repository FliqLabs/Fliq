import SwiftUI

/// A currency a recipient can be paid in. Only the ones with a live corridor carry a `country`; the rest show as soon.
struct PayoutCurrency: Identifiable, Hashable {
    let code: String
    let name: String
    let symbol: String
    let flag: String
    var country: Country?

    var id: String { code }
    var isLive: Bool { country != nil }

    static let live = [
        PayoutCurrency(code: "NGN", name: "Naira", symbol: "₦", flag: "🇳🇬", country: .ng),
        PayoutCurrency(code: "KES", name: "Kenyan Shilling", symbol: "KSh", flag: "🇰🇪", country: .ke),
    ]

    static let stablecoins = [
        PayoutCurrency(code: "USDC", name: "USD Coin, to a wallet", symbol: "$", flag: ""),
    ]

    static let soon = [
        PayoutCurrency(code: "BRL", name: "Brazilian Real", symbol: "R$", flag: "🇧🇷"),
        PayoutCurrency(code: "GBP", name: "British Pound", symbol: "£", flag: "🇬🇧"),
        PayoutCurrency(code: "XOF", name: "CFA Franc BCEAO", symbol: "CFA", flag: "🇸🇳"),
        PayoutCurrency(code: "XAF", name: "CFA Franc BEAC", symbol: "FCFA", flag: "🇨🇲"),
        PayoutCurrency(code: "EGP", name: "Egyptian Pound", symbol: "E£", flag: "🇪🇬"),
        PayoutCurrency(code: "EUR", name: "Euro", symbol: "€", flag: "🇪🇺"),
        PayoutCurrency(code: "GHS", name: "Ghanaian Cedi", symbol: "GH₵", flag: "🇬🇭"),
        PayoutCurrency(code: "INR", name: "Indian Rupee", symbol: "₹", flag: "🇮🇳"),
        PayoutCurrency(code: "IDR", name: "Indonesian Rupiah", symbol: "Rp", flag: "🇮🇩"),
        PayoutCurrency(code: "MXN", name: "Mexican Peso", symbol: "MX$", flag: "🇲🇽"),
        PayoutCurrency(code: "PHP", name: "Philippine Peso", symbol: "₱", flag: "🇵🇭"),
        PayoutCurrency(code: "RWF", name: "Rwandan Franc", symbol: "FRw", flag: "🇷🇼"),
        PayoutCurrency(code: "ZAR", name: "South African Rand", symbol: "R", flag: "🇿🇦"),
        PayoutCurrency(code: "TZS", name: "Tanzanian Shilling", symbol: "TSh", flag: "🇹🇿"),
        PayoutCurrency(code: "UGX", name: "Ugandan Shilling", symbol: "USh", flag: "🇺🇬"),
        PayoutCurrency(code: "USD", name: "US Dollar, to a US bank", symbol: "$", flag: "🇺🇸"),
        PayoutCurrency(code: "ZMW", name: "Zambian Kwacha", symbol: "ZK", flag: "🇿🇲"),
    ]
}

/// How a recipient in one country can be paid.
enum SendMethod: Hashable {
    case bank, mobileMoney, fliqName
}

// MARK: Currency

/// "What currency should they receive?": the corridors that work now on top, everything else marked soon.
struct RecipientCurrencyView: View {
    let onPick: (Country) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("What currency should they receive?")
                    .font(.system(size: 28, weight: .bold))
                    .tracking(-0.5)
                    .padding(.top, 4)
                SearchField(text: $search, prompt: "Search currency or country")
                    .padding(.top, 18)

                section("Available now", live)
                section("Stablecoin", filtered(PayoutCurrency.stablecoins))
                ForEach(letters, id: \.self) { letter in
                    section(letter, filtered(PayoutCurrency.soon).filter { $0.name.hasPrefix(letter) })
                }
                if live.isEmpty && letters.isEmpty && filtered(PayoutCurrency.stablecoins).isEmpty {
                    Text("No currency matches \u{201C}\(search)\u{201D}")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.immediately)
        .navigationBarTitleDisplayMode(.inline)
        .sheetToolbar { dismiss() }
    }

    private var live: [PayoutCurrency] { filtered(PayoutCurrency.live) }

    private var letters: [String] {
        Array(Set(filtered(PayoutCurrency.soon).map { String($0.name.prefix(1)) })).sorted()
    }

    private func filtered(_ list: [PayoutCurrency]) -> [PayoutCurrency] {
        let query = search.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return list }
        return list.filter { [$0.name, $0.code, $0.country?.name ?? ""].contains { $0.localizedCaseInsensitiveContains(query) } }
    }

    @ViewBuilder
    private func section(_ title: String, _ items: [PayoutCurrency]) -> some View {
        if !items.isEmpty {
            Text(title)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .padding(.top, 26)
                .padding(.bottom, 8)
            VStack(spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.element) { index, currency in
                    Button { if let country = currency.country { onPick(country) } } label: {
                        row(currency, isLast: index == items.count - 1)
                    }
                    .disabled(!currency.isLive)
                    .accessibilityIdentifier(currency.code)
                }
            }
            .background(Theme.surfaceRaised.opacity(0.7), in: RoundedRectangle(cornerRadius: 20))
        }
    }

    private func row(_ currency: PayoutCurrency, isLast: Bool) -> some View {
        HStack(spacing: 14) {
            Group {
                if currency.flag.isEmpty {
                    TokenLogo(token: currency.code, size: 40)
                } else {
                    Text(currency.flag).font(.system(size: 54)).frame(width: 40, height: 40).clipShape(Circle())
                }
            }
            .opacity(currency.isLive ? 1 : 0.55)
            VStack(alignment: .leading, spacing: 3) {
                Text(currency.name).font(.system(size: 17, weight: .semibold))
                Text("\(currency.code) (\(currency.symbol))").font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
            }
            .opacity(currency.isLive ? 1 : 0.55)
            Spacer()
            if currency.isLive {
                Icon("chevron.right", size: 17).foregroundStyle(Theme.textTertiary)
            } else {
                Text("Soon")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.horizontal, 9)
                    .frame(height: 24)
                    .background(Color.white.opacity(0.08), in: Capsule())
            }
        }
        .foregroundStyle(Theme.textPrimary)
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) {
            if !isLast { Rectangle().fill(Color.white.opacity(0.06)).frame(height: 1).padding(.leading, 70) }
        }
    }
}

// MARK: Method

/// "How do you want to send NGN?"
struct SendMethodView: View {
    let country: Country
    let onPick: (SendMethod) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("How do you want to send \(country.currency.rawValue.uppercased())?")
                .font(.system(size: 28, weight: .bold))
                .tracking(-0.5)
                .padding(.top, 4)
            VStack(spacing: 6) {
                option(.bank, symbol: "building.columns.fill", title: "Bank transfer", detail: "To any bank account in \(country.name), new or saved")
                if country == .ke {
                    option(.mobileMoney, symbol: "iphone", title: "Mobile money", detail: "To M-Pesa or Airtel Money, lands in seconds")
                }
                option(.fliqName, symbol: "at", title: "fliq name", detail: "Instantly to another fliq user, with no fee")
            }
            .padding(.top, 26)
            Spacer()
        }
        .padding(.horizontal, 20)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func option(_ method: SendMethod, symbol: String, title: String, detail: String) -> some View {
        Button { onPick(method) } label: {
            HStack(alignment: .top, spacing: 16) {
                Icon(symbol, size: 23)
                    .foregroundStyle(Color(hex: 0x8FB4FF))
                    .frame(width: 48, height: 48)
                    .background(Color(hex: 0x8FB4FF).opacity(0.14), in: Circle())
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.system(size: 17, weight: .semibold))
                    Text(detail).font(.system(size: 15)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 3)
                Spacer(minLength: 0)
                Icon("chevron.right", size: 17).foregroundStyle(Theme.textTertiary).padding(.top, 16)
            }
            .foregroundStyle(Theme.textPrimary)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.pressable(scale: 0.98))
        .accessibilityIdentifier(title)
    }
}

// MARK: Who

/// "Who are you sending to?": a bank or mobile money account, confirmed by the provider before Continue.
struct RecipientFormView: View {
    let country: Country
    let method: SendMethod
    let onContinue: (VerifiedAccount, Bool) -> Void
    @Environment(AppEnvironment.self) private var environment
    @State private var entry: AccountEntry?
    @State private var save = true
    @State private var choosingProvider = false
    @FocusState private var numberFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Who are you sending to?").font(.system(size: 28, weight: .bold)).tracking(-0.5)
                    Text("We check the account with the \(method == .bank ? "bank" : "provider") before you pay.")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.top, 6)
                    if let entry { fields(entry) }
                }
                .padding(.top, 4)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)

            Toggle("Save this recipient", isOn: $save)
                .tint(Theme.confirmed)
                .font(.system(size: 16))
                .padding(.vertical, 8)
            Button("Continue") {
                if let verified = entry?.verified { onContinue(verified, save) }
            }
            .buttonStyle(PrimaryButtonStyle(filled: true))
            .disabled(entry?.verified == nil)
            .padding(.bottom, 12)
        }
        .padding(.horizontal, 20)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard entry == nil else { return }
            let entry = AccountEntry(api: environment.api)
            self.entry = entry
            if entry.country == country { await entry.loadInstitutions() } else { await entry.choose(country) }
            pickFirstProvider(entry)
        }
        .sheet(isPresented: $choosingProvider) {
            if let entry {
                ProviderPicker(entry: entry, providers: providers(entry), title: method == .bank ? "Choose bank" : "Choose provider")
                    .presentationDetents([.medium, .large])
                    .presentationBackground(Color(hex: 0x161616))
            }
        }
    }

    @ViewBuilder
    private func fields(_ entry: AccountEntry) -> some View {
        @Bindable var entry = entry
        label("Recipient country")
        HStack(spacing: 12) {
            CountryFlag(country: country, size: 26)
            Text(country.name).font(.system(size: 17))
            Spacer()
        }
        .padding(.horizontal, 16)
        .frame(height: 56)
        .background(Theme.surfaceRaised.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))

        label(method == .bank ? "Bank" : "Mobile money provider")
        Button { choosingProvider = true } label: {
            HStack(spacing: 12) {
                InstitutionLogo(logoKey: entry.institution.logoKey, name: entry.institution.name, size: 28)
                Text(providers(entry).contains(entry.institution) ? entry.institution.name : "Choose")
                    .font(.system(size: 17))
                Spacer()
                Icon("chevron.down", size: 17).foregroundStyle(Theme.textTertiary)
            }
            .foregroundStyle(Theme.textPrimary)
            .padding(.horizontal, 16)
            .frame(height: 56)
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.white.opacity(0.14)))
        }
        .accessibilityLabel("Bank: \(entry.institution.name)")

        label(method == .bank ? "Account number" : "Phone number")
        HStack {
            TextField("", text: $entry.number, prompt: Text(method == .bank ? "Enter account number" : "07XX XXX XXX").foregroundStyle(Theme.textTertiary))
                .keyboardType(.numberPad)
                .focused($numberFocused)
                .font(.system(size: 18, weight: .medium).monospacedDigit())
                .accessibilityLabel(method == .bank ? "Account number" : "Phone number")
            Text("\(entry.number.count)/\(entry.maxLength)").font(.system(size: 13)).foregroundStyle(Theme.textTertiary)
        }
        .padding(.horizontal, 16)
        .frame(height: 56)
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(entry.verified == nil ? Color.white.opacity(0.14) : Theme.confirmed))
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

        Group {
            if let verified = entry.verified {
                Label { Text(verified.accountName).fontWeight(.semibold) + Text("  ·  confirmed by \(verified.institution)").foregroundStyle(Theme.textTertiary) } icon: {
                    Icon("checkmark.circle.fill", size: 18)
                }
                .foregroundStyle(Theme.confirmed)
            } else if entry.isVerifying {
                HStack(spacing: 8) { ProgressView().controlSize(.mini); Text("Checking with \(entry.institution.name)") }
                    .foregroundStyle(Theme.textSecondary)
            } else if let message = entry.errorMessage {
                Text(message).foregroundStyle(Theme.warning)
            }
        }
        .font(.system(size: 14))
        .padding(.top, 10)

        IconLabel("Check the details. A payout to the wrong account can't be pulled back.", icon: "exclamationmark.shield.fill")
            .font(.system(size: 14))
            .foregroundStyle(Theme.warning)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.warning.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
            .padding(.top, 22)
    }

    private func label(_ text: String) -> some View {
        Text(text).font(.system(size: 15, weight: .medium)).padding(.top, 22).padding(.bottom, 8)
    }

    private func providers(_ entry: AccountEntry) -> [Institution] {
        entry.institutions.filter { method == .mobileMoney ? $0.type == .mobileMoney : $0.type == .bank }
    }

    private func pickFirstProvider(_ entry: AccountEntry) {
        if !providers(entry).contains(entry.institution), let first = providers(entry).first { entry.institution = first }
    }
}

/// A searchable list of banks or mobile money providers, with their logos.
private struct ProviderPicker: View {
    @Bindable var entry: AccountEntry
    let providers: [Institution]
    let title: String
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                SearchField(text: $search, prompt: "Search")
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
                List(shown, id: \.self) { institution in
                    Button {
                        entry.institution = institution
                        dismiss()
                    } label: {
                        HStack(spacing: 14) {
                            InstitutionLogo(logoKey: institution.logoKey, name: institution.name, size: 32)
                            Text(institution.name).font(.system(size: 16))
                            Spacer()
                            if institution == entry.institution {
                                Icon("checkmark", size: 17).foregroundStyle(Theme.confirmed)
                            }
                        }
                        .foregroundStyle(Theme.textPrimary)
                    }
                    .listRowBackground(Color.clear)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .sheetToolbar { dismiss() }
        }
        .tint(Theme.textPrimary)
    }

    private var shown: [Institution] {
        let query = search.trimmingCharacters(in: .whitespaces)
        return query.isEmpty ? providers : providers.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }
}

/// A rounded search box with a clear button.
struct SearchField: View {
    @Binding var text: String
    let prompt: String

    var body: some View {
        HStack(spacing: 10) {
            Icon("magnifyingglass", size: 18).foregroundStyle(Theme.textTertiary)
            TextField("", text: $text, prompt: Text(prompt).foregroundStyle(Theme.textTertiary))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("Search")
            if !text.isEmpty {
                Button { text = "" } label: { Icon("xmark.circle.fill", size: 18).foregroundStyle(Theme.textTertiary) }
                    .accessibilityLabel("Clear search")
            }
        }
        .font(.system(size: 16))
        .padding(.horizontal, 14)
        .frame(height: 50)
        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 14))
    }
}
