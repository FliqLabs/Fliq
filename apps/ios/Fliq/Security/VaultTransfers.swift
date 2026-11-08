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
        let relay = DelegateRelay(api: api, rpc: rpc, keys: keys, pollInterval: pollInterval, pollAttempts: pollAttempts)
        return try await relay.submit(from: sender, reason: "Pay \(recipient)") { nonce, height, key in
            .vaultTransfer(from: sender, to: recipient, units: UInt64(amount.baseUnits), vault: vault, nonce: nonce, blockHeight: height, publicKey: key)
        }
    }
}

/// One call signed by the device key behind Face ID, relayed by `POST /relays` and followed until the chain answers.
struct DelegateRelay: Sendable {
    let api: any FliqAPI
    let rpc: NEARRPC
    let keys: any DeviceKeys
    var pollInterval: Duration = .seconds(1.5)
    var pollAttempts = 20

    func submit(
        from sender: String,
        reason: String,
        _ build: @Sendable (_ nonce: UInt64, _ blockHeight: UInt64, _ publicKey: Data) -> DelegateAction
    ) async throws -> RelayResult {
        let publicKey = try keys.publicKey()
        guard let rawKey = NEARKey.decode(publicKey) else { throw TransferError.notSetUp }
        async let nonce = rpc.accessKeyNonce(account: sender, publicKey: publicKey)
        async let height = rpc.finalBlockHeight()
        let action = build(try await nonce + 1, try await height, rawKey)
        let signature = try keys.sign(action.signingHash, reason: reason)
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
