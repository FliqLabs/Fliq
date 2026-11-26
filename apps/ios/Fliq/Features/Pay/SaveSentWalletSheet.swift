import SwiftUI

/// Offered once after a send to an address with no name yet. Naming it makes it one tap from Recipients next time.
struct SaveSentWalletSheet: View {
    let flow: WithdrawFlow
    @State private var label = ""
    @State private var isSaving = false
    @State private var errorMessage: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Save this wallet")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
                .accessibilityAddTraits(.isHeader)
            if let sent = flow.sent {
                Text("\(sent.network.name) · \(WalletAddress.short(sent.address, on: sent.network.chain))")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.top, 4)
            }
            TextField("", text: $label, prompt: Text("Name it, like Tunde's Binance").foregroundStyle(Theme.textTertiary))
                .focused($focused)
                .textInputAutocapitalization(.words)
                .submitLabel(.done)
                .onSubmit { Task { await save() } }
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(Theme.textPrimary)
                .padding(.horizontal, 16)
                .frame(height: 52)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
                .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.hairline) }
                .padding(.top, 18)
                .accessibilityIdentifier("sent.wallet.label")
            if let errorMessage {
                Text(errorMessage)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.warning)
                    .padding(.top, 8)
            }
            Spacer(minLength: 12)
            HStack(spacing: 12) {
                Button("Not now") { flow.skipSaving() }
                    .buttonStyle(PrimaryButtonStyle())
                Button { Task { await save() } } label: {
                    if isSaving { ProgressView().tint(.black) } else { Text("Save") }
                }
                .buttonStyle(PrimaryButtonStyle(filled: true))
                .disabled(WalletAddress.labelProblem(label) != nil || isSaving)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 28)
        .padding(.bottom, 12)
        .onAppear { focused = true }
        .onChange(of: label) { errorMessage = nil }
    }

    private func save() async {
        guard !isSaving, WalletAddress.labelProblem(label) == nil else { return }
        isSaving = true
        defer { isSaving = false }
        errorMessage = await flow.saveSentWallet(named: label)
    }
}
