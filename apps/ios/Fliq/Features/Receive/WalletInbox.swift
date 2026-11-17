import Security
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
    /// Deposits a route sent back to the user's NEAR Intents balance. Theirs, but outside the vault until brought back.
    private(set) var refunds: [Refund] = []
    private(set) var isReturning = false
    private(set) var refundError: String?
    /// Set once the money is on its way back, until the vault shows it.
    private(set) var refundOnItsWay = false
    var onAdded: @MainActor () async -> Void = {}

    private let topUp: any WalletTopUp

    init(topUp: any WalletTopUp = FixtureWalletTopUp()) {
        self.topUp = topUp
    }

    var refundTotal: TokenAmount {
        TokenAmount(baseUnits: refunds.reduce(0) { $0 + $1.dollars.baseUnits })
    }

    func load() async {
        if !isReturning, let found = try? await topUp.refunds() {
            refunds = found
            if found.isEmpty { refundOnItsWay = false }
        }
        guard !isAdding, let amount = try? await topUp.waiting() else { return }
        waiting = amount
    }

    /// One Face ID per refund. Each moves inside NEAR Intents and lands in the vault in seconds.
    func bringBackRefunds() async {
        guard !refunds.isEmpty, !isReturning else { return }
        isReturning = true
        refundError = nil
        defer { isReturning = false }
        do {
            for refund in refunds {
                _ = try await topUp.bringBack(refund)
            }
            refunds = []
            refundOnItsWay = true
            await onAdded()
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(15))
                await self?.load()
                await self?.onAdded()
            }
        } catch let error as KeychainError where error.status == errSecUserCanceled || error.status == errSecAuthFailed {
            refundError = nil
        } catch {
            refundError = "Couldn't bring it back right now. Your money is safe; try again in a moment."
        }
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

/// "$1.63 came back from a deposit": money a deposit route returned, with the one tap that puts it in the vault.
/// Shows nothing while there is nothing to bring back.
struct RefundCard: View {
    let inbox: WalletInbox

    var body: some View {
        if !inbox.refunds.isEmpty || inbox.refundOnItsWay {
            Button {
                Task { await inbox.bringBackRefunds() }
            } label: {
                HStack(spacing: 14) {
                    Icon("arrow.uturn.backward", size: 20)
                        .foregroundStyle(Theme.confirmed)
                        .frame(width: 50, height: 50)
                        .background(Theme.surfaceRaised, in: Circle())
                    VStack(alignment: .leading, spacing: 3) {
                        Text(title)
                            .font(.system(size: 17, weight: .medium))
                            .foregroundStyle(Theme.textPrimary)
                        Text(subtitle)
                            .font(.system(size: 15))
                            .foregroundStyle(inbox.refundError == nil ? Theme.textSecondary : Theme.warning)
                            .lineLimit(2)
                    }
                    Spacer(minLength: 8)
                    if inbox.isReturning {
                        ProgressView()
                    } else if !inbox.refundOnItsWay {
                        Icon("chevron.right", size: 18).foregroundStyle(Theme.textSecondary)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 26))
                .contentShape(RoundedRectangle(cornerRadius: 26))
            }
            .buttonStyle(.plain)
            .disabled(inbox.isReturning || inbox.refundOnItsWay)
            .accessibilityIdentifier("home.refund")
            .accessibilityHint("Adds it back to your vault")
        }
    }

    private var title: String {
        inbox.refundOnItsWay ? "Back to your vault" : "$\(Money.dollars(inbox.refundTotal)) came back from a deposit"
    }

    private var subtitle: String {
        if inbox.isReturning { return "Adding it back" }
        if inbox.refundOnItsWay { return "It lands in a few seconds" }
        return inbox.refundError ?? "Your money is safe. Tap to add it to your vault"
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

    var body: some View {
        NEARMark(size: 18)
            .frame(width: 40, height: 40)
            .background(Color.black, in: Circle())
            .padding(5)
            .overlay {
                TimelineView(.animation(paused: !spinning)) { context in
                    let turn = spinning ? context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2) / 2 : 0
                    Circle()
                        .strokeBorder(spinning ? Color.white : Theme.surfaceRaised, style: StrokeStyle(lineWidth: 2.5, dash: spinning ? [10, 8] : []))
                        .rotationEffect(.degrees(turn * 360))
                }
            }
    }
}
