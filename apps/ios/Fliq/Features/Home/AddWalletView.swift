import SwiftUI
import UIKit

/// What the add form opens with: empty, or an address sent to before that only needs a name.
struct WalletDraft: Identifiable {
    let id = UUID()
    var chain = WalletChain.solana
    var address = ""
}

/// The add form's rules, apart from the screen so they can be tested.
struct WalletForm: Equatable {
    var label = ""
    var chain = WalletChain.solana
    var address = "" {
        didSet {
            // A pasted Tron, Solana or NEAR address picks its own network. 0x addresses fit two, so they leave it.
            if address != oldValue, let guessed = WalletChain.guess(address), WalletAddress.problem(address, on: chain) != nil { chain = guessed }
        }
    }

    var labelProblem: String? { WalletAddress.labelProblem(label) }
    var addressProblem: String? { WalletAddress.problem(address, on: chain) }
    var canSave: Bool { labelProblem == nil && addressProblem == nil }

    var input: SavedWalletInput {
        SavedWalletInput(
            label: label.trimmingCharacters(in: .whitespacesAndNewlines),
            chain: chain.rawValue,
            address: WalletAddress.normalized(address, on: chain),
            token: chain.token
        )
    }
}

/// Name, network, address, Save. The address is checked as it is typed, and again by the server.
struct AddWalletView: View {
    let onDone: () -> Void
    @Environment(AppEnvironment.self) private var environment
    @State private var form: WalletForm
    @State private var isSaving = false
    @State private var errorMessage: String?
    @FocusState private var focus: Field?

    private enum Field { case label, address }

    init(draft: WalletDraft, onDone: @escaping () -> Void) {
        self.onDone = onDone
        _form = State(initialValue: WalletForm(chain: draft.chain, address: draft.address))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("New wallet")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.top, 28)
                field("Name") {
                    TextField("", text: $form.label, prompt: Text("Tunde's Binance").foregroundStyle(Theme.textTertiary))
                        .focused($focus, equals: .label)
                        .textInputAutocapitalization(.words)
                        .submitLabel(.next)
                        .onSubmit { focus = form.address.isEmpty ? .address : nil }
                        .accessibilityIdentifier("wallet.label")
                }
                .padding(.top, 24)
                if let problem = form.labelProblem, !problem.isEmpty { note(problem) }
                Text("Network")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.top, 20)
                    .padding(.leading, 4)
                networks.padding(.top, 8)
                field("\(form.chain.name) address", ready: form.addressProblem == nil) {
                    HStack(spacing: 10) {
                        TextField("", text: $form.address, prompt: Text(form.chain == .near ? "name.near or address" : "Paste the address").foregroundStyle(Theme.textTertiary))
                            .focused($focus, equals: .address)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.asciiCapable)
                            .font(.system(size: 16, weight: .medium, design: .monospaced))
                            .lineLimit(1)
                            .submitLabel(.done)
                            .accessibilityIdentifier("wallet.address")
                        if form.address.isEmpty {
                            Button("Paste") { form.address = UIPasteboard.general.string ?? "" }
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Theme.textPrimary)
                                .padding(.horizontal, 12)
                                .frame(height: 32)
                                .background(Theme.surfaceRaised, in: Capsule())
                        }
                    }
                }
                .padding(.top, 20)
                if let problem = form.addressProblem, !problem.isEmpty { note(problem) }
                if let errorMessage { note(errorMessage) }
            }
            .padding(.horizontal, 20)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            Button { Task { await save() } } label: {
                if isSaving { ProgressView().tint(.black) } else { Text("Save") }
            }
            .buttonStyle(PrimaryButtonStyle(filled: true))
            .disabled(!form.canSave || isSaving)
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
            .accessibilityIdentifier("wallet.save")
        }
        .onAppear { focus = .label }
        .onChange(of: form) { errorMessage = nil }
        .animation(.snappy(duration: 0.2), value: form.chain)
    }

    private var networks: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(WalletChain.allCases) { chain in
                    let picked = chain == form.chain
                    Button { form.chain = chain } label: {
                        HStack(spacing: 6) {
                            ChainBadge(chain: chain, size: 20, ring: false)
                            Text(chain.name).fixedSize()
                        }
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(picked ? .black : Theme.textPrimary)
                        .padding(.leading, 8)
                        .padding(.trailing, 14)
                        .frame(minHeight: 40)
                        .background(picked ? Color.white : Theme.surface, in: Capsule())
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.pressable)
                    .accessibilityAddTraits(picked ? .isSelected : [])
                    .accessibilityIdentifier("wallet.network.\(chain.rawValue)")
                }
            }
        }
        .scrollClipDisabled()
    }

    private func field<Content: View>(_ title: String, ready: Bool = false, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
            content()
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(Theme.textPrimary)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20))
        .overlay { RoundedRectangle(cornerRadius: 20).strokeBorder(ready ? Theme.confirmed : Theme.hairline) }
    }

    private func note(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Icon("exclamationmark.circle", size: 16)
            Text(text).fixedSize(horizontal: false, vertical: true)
        }
        .font(.system(size: 14))
        .foregroundStyle(Theme.warning)
        .padding(.top, 10)
        .padding(.horizontal, 4)
    }

    private func save() async {
        guard form.canSave else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await environment.wallets.save(form.input)
            onDone()
        } catch {
            errorMessage = WalletSaveError.message(error)
        }
    }
}

enum WalletSaveError {
    static func message(_ error: Error) -> String {
        if case APIError.server(_, let detail) = error { return detail.message }
        return "Couldn't save the wallet. Check your connection and try again."
    }
}

/// The network's mark in a dark ring, on a recipient's avatar or in the network picker.
struct ChainBadge: View {
    let chain: WalletChain?
    var size: CGFloat
    var ring = true

    var body: some View {
        Group {
            if let chain {
                Image(chain.image).resizable().scaledToFit()
            } else {
                Icon("wallet.bifold", size: size * 0.5).foregroundStyle(Theme.textPrimary)
            }
        }
        .frame(width: size, height: size)
        .background(Color(hex: 0x111111))
        .clipShape(Circle())
        .overlay { if ring { Circle().strokeBorder(Color(hex: 0x141414), lineWidth: 2) } }
        .accessibilityHidden(true)
    }
}
