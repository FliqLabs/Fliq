import Foundation

/// Sends dollars from the vault to a NEAR address outside fliq.
protocol Withdrawals: Sendable {
    func check(_ address: String) async -> AddressCheck
    func send(_ amount: TokenAmount, to address: String) async throws -> WithdrawReceipt
}

enum AddressCheck: Equatable {
    /// `needsSetup` when the address has never held USDC: the transfer registers it first, for a tenth of a cent.
    case ready(needsSetup: Bool)
    case invalid(String)
    case unavailable
}

struct WithdrawReceipt: Equatable, Sendable {
    let transactionHash: String
}

enum WithdrawError: Error, Equatable {
    case notSetUp
    case needsGas
    case invalidAddress(String)
    /// The vault refused, so nothing moved.
    case refused(String)
    case stillPending
    /// The vault paid out to the user's own account, but the onward transfer failed. The money waits there.
    case notDelivered(String)
}

/// The rules that need no network: what fliq refuses to send to.
enum WithdrawAddress {
    private static let account = #"^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$"#
    private static let implicit = "^[0-9a-f]{64}$"
    private static let evm = "^0x[0-9a-f]{40}$"

    private static func matches(_ address: String, _ pattern: String) -> Bool {
        address.range(of: pattern, options: .regularExpression) != nil
    }

    static func normalized(_ typed: String) -> String {
        typed.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// A 64 character hex account exists as soon as it receives something, so it needs no lookup.
    static func isImplicit(_ address: String) -> Bool {
        matches(address, implicit)
    }

    static func problem(_ address: String, own: String?, contracts: [String]) -> String? {
        if address.isEmpty { return "" }
        if matches(address, evm) { return "That's an Ethereum or Base address. fliq sends on NEAR for now." }
        if !matches(address, account) { return "That isn't a NEAR address." }
        if address == own { return "That's your own fliq account." }
        if contracts.contains(address) { return "That's a fliq contract, not a wallet." }
        return nil
    }
}

/// Two steps behind one Face ID: the relayer runs the vault's `withdraw` to the user's own account for free, then
/// the phone sends that USDC on with a plain transaction. The relayer has no rule for a transfer out, so the user's
/// account pays that gas, about $0.001.
struct RelayedWithdrawals: Withdrawals {
    let api: any FliqAPI
    let rpc: NEARRPC
    let keys: any DeviceKeys
    let owner: @Sendable () async -> String?
    let vault: @Sendable () async -> String?
    var pollInterval: Duration = .seconds(1.5)
    var pollAttempts = 20

    /// 30 Tgas of prepaid gas at one and a half times the minimum gas price, in yoctoNEAR.
    static let gasAllowance = Decimal(string: "4500000000000000000000")!
    private static let yoctoPerStorageByte = Decimal(string: "10000000000000000000")!

    func check(_ typed: String) async -> AddressCheck {
        let address = WithdrawAddress.normalized(typed)
        guard let owner = await owner(), let vault = await vault() else { return .unavailable }
        do {
            let usdc = try await rpc.vaultUSDC(vault: vault)
            if let problem = WithdrawAddress.problem(address, own: owner, contracts: [vault, usdc]) { return .invalid(problem) }
            if !WithdrawAddress.isImplicit(address), try await rpc.account(address) == nil {
                return .invalid("No NEAR account has that name.")
            }
            return .ready(needsSetup: try await !rpc.isRegistered(address, on: usdc))
        } catch {
            return .unavailable
        }
    }

    func send(_ amount: TokenAmount, to typed: String) async throws -> WithdrawReceipt {
        let address = WithdrawAddress.normalized(typed)
        guard amount > .zero, let owner = await owner(), let vault = await vault() else { throw WithdrawError.notSetUp }
        let usdc = try await rpc.vaultUSDC(vault: vault)
        if let problem = WithdrawAddress.problem(address, own: owner, contracts: [vault, usdc]) {
            throw WithdrawError.invalidAddress(problem)
        }
        let publicKey = try keys.publicKey()
        guard let rawKey = NEARKey.decode(publicKey) else { throw WithdrawError.notSetUp }

        async let registered = rpc.isRegistered(address, on: usdc)
        async let account = rpc.account(owner)
        async let block = rpc.finalBlock()
        async let nonce = rpc.accessKeyNonce(account: owner, publicKey: publicKey)
        let registration = try await registered ? nil : try await rpc.registrationCost(on: usdc)
        guard let state = try await account, Self.covers(state, registration: registration) else { throw WithdrawError.needsGas }
        let header = try await block
        guard let hash = header.hash, let blockHash = NEARKey.base58Decode(hash), blockHash.count == 32 else { throw WithdrawError.notSetUp }
        let next = try await nonce + 1
        let units = UInt64(amount.baseUnits)

        let withdraw = DelegateAction.vaultWithdraw(from: owner, units: units, vault: vault, nonce: next, blockHeight: header.height, publicKey: rawKey)
        let transfer = NEARTransaction.usdcTransfer(
            from: owner, to: address, units: units, usdc: usdc, registration: registration,
            nonce: next + 1, blockHash: blockHash, publicKey: rawKey
        )
        let signatures = try keys.sign([withdraw.signingHash, transfer.signingHash], reason: "Send $\(Money.dollars(amount)) to \(address)")

        let relay = DelegateRelay(api: api, rpc: rpc, keys: keys, pollInterval: pollInterval, pollAttempts: pollAttempts)
        do {
            _ = try await relay.follow(try await api.relay(signedDelegate: withdraw.signed(with: signatures[0])))
        } catch TransferError.refused(let reason) {
            throw WithdrawError.refused(reason)
        } catch TransferError.stillPending {
            throw WithdrawError.stillPending
        }

        let outcome: NEARRPC.Outcome
        do {
            outcome = try await rpc.send(signedTransaction: transfer.signed(with: signatures[1]))
        } catch {
            throw WithdrawError.notDelivered(String(describing: error))
        }
        if let failure = outcome.failure { throw WithdrawError.notDelivered(failure) }
        return WithdrawReceipt(transactionHash: outcome.hash)
    }

    /// NEAR checks the prepaid gas and any deposit against what the account holds beyond its own storage.
    static func covers(_ account: NEARRPC.Account, registration: Yocto?) -> Bool {
        guard let balance = Decimal(string: account.amount) else { return false }
        let spendable = balance - Decimal(account.storageUsage) * yoctoPerStorageByte
        return spendable >= gasAllowance + (registration?.decimal ?? 0)
    }
}

/// The demo build has no chain behind it, so every address is ready and every send lands.
struct FixtureWithdrawals: Withdrawals {
    func check(_ address: String) async -> AddressCheck {
        let address = WithdrawAddress.normalized(address)
        if let problem = WithdrawAddress.problem(address, own: nil, contracts: []) { return .invalid(problem) }
        return .ready(needsSetup: false)
    }

    func send(_ amount: TokenAmount, to address: String) async throws -> WithdrawReceipt {
        WithdrawReceipt(transactionHash: "")
    }
}
