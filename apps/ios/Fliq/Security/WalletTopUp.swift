import Foundation

/// USDC sent straight to a fliq name lands in the user's own NEAR account, outside the vault the app shows.
protocol WalletTopUp: Sendable {
    func waiting() async throws -> TokenAmount
    func addToVault(_ amount: TokenAmount) async throws -> RelayResult?
    /// Money a deposit route sent back to the user's NEAR Intents balance.
    func refunds() async throws -> [Refund]
    /// Carries one refund back into the vault: the API opens the route, Face ID signs the move.
    func bringBack(_ refund: Refund) async throws -> RelayResult?
}

extension WalletTopUp {
    func refunds() async throws -> [Refund] { [] }
    func bringBack(_ refund: Refund) async throws -> RelayResult? { nil }
}

/// Reads that USDC from the chain and moves it in with a signed `ft_transfer_call`, relayed by `POST /relays`.
struct RelayedWalletTopUp: WalletTopUp {
    let rpc: NEARRPC
    let relay: DelegateRelay
    let owner: @Sendable () async -> String?
    let vault: @Sendable () async -> String?

    func waiting() async throws -> TokenAmount {
        guard let owner = await owner(), let vault = await vault() else { return .zero }
        let usdc = try await rpc.vaultUSDC(vault: vault)
        return try await rpc.usdcBalance(of: owner, usdc: usdc)
    }

    func refunds() async throws -> [Refund] {
        try await relay.api.refunds()
    }

    func bringBack(_ refund: Refund) async throws -> RelayResult? {
        guard let owner = await owner() else { throw TransferError.notSetUp }
        let route = try await relay.api.returnRefund(tokenId: refund.tokenId, idempotencyKey: UUID().uuidString)
        return try await relay.submit(from: owner, reason: "Add \(Money.dollars(refund.dollars)) back to fliq") { nonce, height, key in
            .intentsReturn(from: owner, refund: route, nonce: nonce, blockHeight: height, publicKey: key)
        }
    }

    func addToVault(_ amount: TokenAmount) async throws -> RelayResult? {
        guard amount > .zero, let owner = await owner(), let vault = await vault() else { throw TransferError.notSetUp }
        let usdc = try await rpc.vaultUSDC(vault: vault)
        return try await relay.submit(from: owner, reason: "Add \(Money.dollars(amount)) to fliq") { nonce, height, key in
            .walletTopUp(from: owner, units: UInt64(amount.baseUnits), usdc: usdc, vault: vault, nonce: nonce, blockHeight: height, publicKey: key)
        }
    }
}

/// The demo build has nothing waiting outside the vault.
struct FixtureWalletTopUp: WalletTopUp {
    var amount: TokenAmount = .zero
    var refund: Refund?

    func waiting() async throws -> TokenAmount { amount }
    func addToVault(_ amount: TokenAmount) async throws -> RelayResult? { nil }
    func refunds() async throws -> [Refund] { refund.map { [$0] } ?? [] }
}
