import Foundation

/// Moves dollars from the user's vault balance to another fliq user's, instantly and without a fee.
protocol VaultTransfers: Sendable {
    func send(_ amount: TokenAmount, to recipient: String) async throws -> RelayResult?
    /// The same send, telling the caller the moment Face ID has passed, before the chain answers.
    func send(_ amount: TokenAmount, to recipient: String, onSigned: @Sendable () async -> Void) async throws -> RelayResult?
    /// Signs the vault `payout` for a cash-out the API registered, so the vault releases its USDC to the deposit address.
    func release(_ payout: Payout) async throws -> RelayResult?
    /// A send that pays a payment request from its link, so the API marks the request paid as it lands.
    func send(_ amount: TokenAmount, to recipient: String, paying requestCode: String?, onSigned: @Sendable () async -> Void) async throws -> RelayResult?
}

extension VaultTransfers {
    func send(_ amount: TokenAmount, to recipient: String, onSigned: @Sendable () async -> Void) async throws -> RelayResult? {
        await onSigned()
        return try await send(amount, to: recipient)
    }

    func send(_ amount: TokenAmount, to recipient: String, paying requestCode: String?, onSigned: @Sendable () async -> Void) async throws -> RelayResult? {
        try await send(amount, to: recipient, onSigned: onSigned)
    }
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
        try await send(amount, to: recipient, onSigned: {})
    }

    func send(_ amount: TokenAmount, to recipient: String, onSigned: @Sendable () async -> Void) async throws -> RelayResult? {
        try await send(amount, to: recipient, paying: nil, onSigned: onSigned)
    }

    func send(_ amount: TokenAmount, to recipient: String, paying requestCode: String?, onSigned: @Sendable () async -> Void) async throws -> RelayResult? {
        guard amount > .zero, let sender = await sender(), let vault = await vault() else { throw TransferError.notSetUp }
        var relay = DelegateRelay(api: api, rpc: rpc, keys: keys, pollInterval: pollInterval, pollAttempts: pollAttempts)
        relay.requestCode = requestCode
        return try await relay.submit(from: sender, reason: "Pay \(recipient)", onSigned: onSigned) { nonce, height, key in
            .vaultTransfer(from: sender, to: recipient, units: UInt64(amount.baseUnits), vault: vault, nonce: nonce, blockHeight: height, publicKey: key)
        }
    }

    func release(_ payout: Payout) async throws -> RelayResult? {
        guard payout.deposit.chain == "near" else { return nil }
        guard let sender = await sender(), let vault = await vault() else { throw TransferError.notSetUp }
        let relay = DelegateRelay(api: api, rpc: rpc, keys: keys, pollInterval: pollInterval, pollAttempts: pollAttempts)
        return try await relay.submit(from: sender, reason: "Send \(Money.local(payout.receive, payout.currency)) to \(payout.accountName)") { nonce, height, key in
            .vaultPayout(
                from: sender, orderId: payout.payoutId, units: UInt64(payout.deposit.amount.baseUnits), depositAddress: payout.deposit.address,
                vault: vault, nonce: nonce, blockHeight: height, publicKey: key
            )
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
    /// Set when the delegate pays a payment request, passed to `POST /relays` as `request_code`.
    var requestCode: String?

    func submit(
        from sender: String,
        reason: String,
        onSigned: @Sendable () async -> Void = {},
        _ build: @Sendable (_ nonce: UInt64, _ blockHeight: UInt64, _ publicKey: Data) -> DelegateAction
    ) async throws -> RelayResult {
        try await submitDelegate(from: sender, reason: reason, onSigned: onSigned, build)
    }

    /// The same for any delegate, such as a key change, signed by whichever key `keys` holds.
    func submitDelegate<Action: SignableDelegate>(
        from sender: String,
        reason: String,
        onSigned: @Sendable () async -> Void = {},
        _ build: @Sendable (_ nonce: UInt64, _ blockHeight: UInt64, _ publicKey: Data) -> Action
    ) async throws -> RelayResult {
        let publicKey = try keys.publicKey()
        guard let rawKey = NEARKey.decode(publicKey) else { throw TransferError.notSetUp }
        async let nonce = rpc.accessKeyNonce(account: sender, publicKey: publicKey)
        async let height = rpc.finalBlockHeight()
        let action = build(try await nonce + 1, try await height, rawKey)
        let signature = try keys.sign(action.signingHash, reason: reason)
        await onSigned()
        return try await follow(try await api.relay(signedDelegate: action.signed(with: signature), requestCode: requestCode))
    }

    /// Polls a relayed call until the chain answers.
    func follow(_ submitted: RelayResult) async throws -> RelayResult {
        var result = submitted
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
    func release(_ payout: Payout) async throws -> RelayResult? { nil }
}
