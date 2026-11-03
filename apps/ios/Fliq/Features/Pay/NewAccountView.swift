import SwiftUI

struct NewAccountView: View {
    @Bindable var flow: PayFlow
    @Environment(AppEnvironment.self) private var environment
    @FocusState private var numberFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            countries
                .padding(.top, 28)

            VStack(alignment: .leading, spacing: 10) {
                bankPicker
                numberField
                verification
            }
            .padding(.top, 28)

            Toggle("Save this account", isOn: $flow.saveAccount)
                .tint(Theme.confirmed)
                .font(.system(size: 16))
                .padding(.horizontal, 16)
                .frame(height: 54)
                .background(Color(hex: 0x1C1C1C), in: RoundedRectangle(cornerRadius: 12))
                .padding(.top, 28)

            Spacer()

            Button("Continue") { environment.router.push(.payAmount) }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(flow.verified == nil)
                .padding(.bottom, 12)
        }
        .fliqScreen("New account")
        .onAppear { numberFocused = true }
        .onChange(of: flow.accountNumber) {
            flow.accountNumber = String(flow.accountNumber.filter(\.isNumber).prefix(PayFlow.accountNumberLength))
            if flow.isAccountNumberComplete {
                numberFocused = false
                Task { await flow.verifyAccount() }
            }
        }
    }

    private var countries: some View {
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
                .background(Color(hex: 0x1C1C1C), in: Capsule())
        }
        .font(.system(size: 14, weight: .medium))
    }

    private var bankPicker: some View {
        Menu {
            Picker("Bank", selection: $flow.institution) {
                ForEach(Institution.supported, id: \.self) { Text($0.name).tag($0) }
            }
        } label: {
            HStack {
                Image(systemName: "building.columns")
                    .foregroundStyle(Theme.textSecondary)
                Text(flow.institution.name)
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                Image(systemName: "chevron.down")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textTertiary)
            }
            .font(.system(size: 16))
            .padding(.horizontal, 16)
            .frame(height: 54)
            .background(Color(hex: 0x1C1C1C), in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private var numberField: some View {
        HStack {
            TextField("Account number", text: $flow.accountNumber)
                .keyboardType(.numberPad)
                .textContentType(.none)
                .focused($numberFocused)
                .font(.system(size: 18).monospacedDigit())
                .tracking(1)
            Text("\(flow.accountNumber.count)/\(PayFlow.accountNumberLength)")
                .font(.system(size: 12))
                .foregroundStyle(Theme.textTertiary)
        }
        .padding(.horizontal, 16)
        .frame(height: 54)
        .background(Color(hex: 0x1C1C1C), in: RoundedRectangle(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(flow.verified == nil ? .clear : Theme.confirmed)
        }
    }

    @ViewBuilder
    private var verification: some View {
        if let verified = flow.verified {
            HStack(spacing: 6) {
                Image(systemName: "checkmark.circle")
                Text(verified.accountName).fontWeight(.semibold)
                Text("· confirmed by \(verified.institution)").foregroundStyle(Theme.textTertiary)
            }
            .font(.system(size: 13))
            .foregroundStyle(Theme.confirmed)
            .padding(.horizontal, 4)
        } else if flow.isVerifying {
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini)
                Text("Checking with \(flow.institution.name)")
            }
            .font(.system(size: 13))
            .foregroundStyle(Theme.textSecondary)
            .padding(.horizontal, 4)
        } else if let message = flow.errorMessage {
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(Theme.warning)
                .padding(.horizontal, 4)
        }
    }
}

#Preview {
    NavigationStack {
        NewAccountView(flow: PayFlow(api: FixtureClient()))
    }
    .environment(AppEnvironment.preview)
}
