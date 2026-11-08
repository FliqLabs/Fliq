import SwiftUI

/// USDC waiting in the user's own NEAR account, and the one tap that moves it into the vault.
@MainActor
@Observable
final class WalletInbox {
    static let needsNEAR = "Your account needs a tiny bit of NEAR to move this. Try again in a minute."
    static let failed = "Couldn't add it to fliq. Try again in a moment."

    private(set) var waiting: TokenAmount = .zero
    private(set) var isAdding = false
    private(set) var errorMessage: String?
    var onAdded: @MainActor () async -> Void = {}

    private let topUp: any WalletTopUp

    init(topUp: any WalletTopUp = FixtureWalletTopUp()) {
        self.topUp = topUp
    }

    func load() async {
        guard !isAdding, let amount = try? await topUp.waiting() else { return }
        waiting = amount
    }

    func add() async {
        guard waiting > .zero, !isAdding else { return }
        isAdding = true
        errorMessage = nil
        defer { isAdding = false }
        do {
            _ = try await topUp.addToVault(waiting)
            waiting = .zero
            await onAdded()
        } catch {
            errorMessage = Self.message(for: error)
        }
    }

    /// A NEAR account with nothing in it cannot attach the one yoctoNEAR `ft_transfer_call` needs.
    static func message(for error: Error) -> String {
        let detail: String
        switch error {
        case TransferError.refused(let reason): detail = reason
        case APIError.server(_, let reason): detail = reason.message
        case let error as NEARRPCError: detail = error.message
        default: detail = ""
        }
        return detail.localizedCaseInsensitiveContains("balance") ? needsNEAR : failed
    }
}

/// "$20.00 arrived on NEAR" with the button that adds it. Shows nothing while nothing is waiting.
struct WalletArrivedCard: View {
    let inbox: WalletInbox

    var body: some View {
        if inbox.waiting > .zero {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    NEARMark(size: 16).frame(width: 36, height: 36).background(Color.black, in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text("$\(Money.dollars(inbox.waiting)) arrived on NEAR").font(.system(size: 16, weight: .semibold))
                        Text("Add it to fliq to spend it").font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
                    }
                }
                Button {
                    Task { await inbox.add() }
                } label: {
                    if inbox.isAdding { ProgressView().tint(.black) } else { Text("Add to fliq") }
                }
                .buttonStyle(PrimaryButtonStyle(filled: true))
                .disabled(inbox.isAdding)
                if let message = inbox.errorMessage {
                    Text(message).font(.system(size: 13)).foregroundStyle(Theme.warning)
                }
            }
            .padding(16)
            .fliqGlass(RoundedRectangle(cornerRadius: 24))
        }
    }
}
