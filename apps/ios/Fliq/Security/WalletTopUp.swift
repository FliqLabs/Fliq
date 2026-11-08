import Foundation

/// USDC sent straight to a fliq name lands in the user's own NEAR account, outside the vault the app shows.
protocol WalletTopUp: Sendable {
    func waiting() async throws -> TokenAmount
    func addToVault(_ amount: TokenAmount) async throws -> RelayResult?
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

    func waiting() async throws -> TokenAmount { amount }
    func addToVault(_ amount: TokenAmount) async throws -> RelayResult? { nil }
}
