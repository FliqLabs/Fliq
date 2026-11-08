import Foundation

/// Moves dollars from the user's vault balance to another fliq user's, instantly and without a fee.
protocol VaultTransfers: Sendable {
    func send(_ amount: TokenAmount, to recipient: String) async throws -> RelayResult?
}

enum TransferError: Error, Equatable {
    case notSetUp
    case refused(String)
    case stillPending
}

/// Signs a vault `transfer` with the device key and hands it to `POST /relays`, which pays the gas.
struct RelayedVaultTransfers: VaultTransfers {
    let api: any FliqAPI
    let rpc: NEARRPC
    let keys: any DeviceKeys
    let sender: @Sendable () async -> String?
    let vault: @Sendable () async -> String?
    var pollInterval: Duration = .seconds(1.5)
    var pollAttempts = 20

    func send(_ amount: TokenAmount, to recipient: String) async throws -> RelayResult? {
        guard amount > .zero, let sender = await sender(), let vault = await vault() else { throw TransferError.notSetUp }
        let publicKey = try keys.publicKey()
        guard let rawKey = NEARKey.decode(publicKey) else { throw TransferError.notSetUp }
        async let nonce = rpc.accessKeyNonce(account: sender, publicKey: publicKey)
        async let height = rpc.finalBlockHeight()
        let action = try await DelegateAction.vaultTransfer(
            from: sender, to: recipient, units: UInt64(amount.baseUnits), vault: vault,
            nonce: nonce + 1, blockHeight: height, publicKey: rawKey
        )
        let signature = try keys.sign(action.signingHash, reason: "Pay \(recipient)")
        var result = try await api.relay(signedDelegate: action.signed(with: signature))
        for _ in 0..<pollAttempts where result.status == .pending {
            try await Task.sleep(for: pollInterval)
            result = try await api.relayResult(hash: result.delegateHash)
        }
        switch result.status {
        case .succeeded: return result
        case .pending: throw TransferError.stillPending
        case .failed: throw TransferError.refused(result.failures?.first ?? "The vault refused the transfer.")
        }
    }
}

/// The demo build has no chain behind it, so a transfer always lands.
struct FixtureVaultTransfers: VaultTransfers {
    func send(_ amount: TokenAmount, to recipient: String) async throws -> RelayResult? { nil }
}
