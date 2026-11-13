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

/// "$20 arrived on NEAR" as one row, styled like an in-progress payout: tapping it adds the money to the vault.
/// Shows nothing while nothing is waiting.
struct WalletArrivedCard: View {
    let inbox: WalletInbox

    var body: some View {
        if inbox.waiting > .zero {
            Button {
                Task { await inbox.add() }
            } label: {
                HStack(spacing: 14) {
                    MarkRing(spinning: inbox.isAdding)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("$\(Money.dollars(inbox.waiting)) arrived on NEAR")
                            .font(.system(size: 17, weight: .medium))
                            .foregroundStyle(Theme.textPrimary)
                        Text(subtitle)
                            .font(.system(size: 15))
                            .foregroundStyle(inbox.errorMessage == nil ? Theme.textSecondary : Theme.warning)
                            .lineLimit(2)
                    }
                    Spacer(minLength: 8)
                    Icon("chevron.right", size: 18)
                        .foregroundStyle(Theme.textSecondary)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 26))
                .contentShape(RoundedRectangle(cornerRadius: 26))
            }
            .buttonStyle(.plain)
            .disabled(inbox.isAdding)
            .accessibilityHint("Adds it to your fliq balance")
        }
    }

    private var subtitle: String {
        if inbox.isAdding { return "Adding to fliq" }
        return inbox.errorMessage ?? "Tap to add to fliq"
    }
}

/// The NEAR mark in a ring that turns dashed and spins while the money moves.
private struct MarkRing: View {
    let spinning: Bool
    @State private var angle = 0.0

    var body: some View {
        NEARMark(size: 18)
            .frame(width: 40, height: 40)
            .background(Color.black, in: Circle())
            .padding(5)
            .overlay {
                Circle()
                    .strokeBorder(spinning ? Color.white : Theme.surfaceRaised, style: StrokeStyle(lineWidth: 2.5, dash: spinning ? [10, 8] : []))
                    .rotationEffect(.degrees(angle))
            }
            .onChange(of: spinning, initial: true) { _, on in
                angle = 0
                guard on else { return }
                withAnimation(.linear(duration: 2).repeatForever(autoreverses: false)) { angle = 360 }
            }
    }
}
