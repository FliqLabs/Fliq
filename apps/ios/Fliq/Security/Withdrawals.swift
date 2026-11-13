import Foundation

/// Sends dollars from the vault to a NEAR address outside fliq.
protocol Withdrawals: Sendable {
    func check(_ address: String) async -> AddressCheck
    /// Everything the send needs from the network, read while the person looks at Review, so Face ID appears the
    /// moment they tap.
    func prepare(_ amount: TokenAmount, to address: String) async throws -> PreparedWithdraw
    /// Face ID and nothing else.
    func sign(_ prepared: PreparedWithdraw) throws -> SignedWithdraw
    func deliver(_ signed: SignedWithdraw) async throws -> WithdrawReceipt
}

extension Withdrawals {
    func send(_ amount: TokenAmount, to address: String) async throws -> WithdrawReceipt {
        try await deliver(try sign(try await prepare(amount, to: address)))
    }
}

/// The withdraw and the onward steps, built and ready to sign.
struct PreparedWithdraw: Sendable {
    let amount: TokenAmount
    let address: String
    let actions: [DelegateAction]
    var preparedAt = Date.now

    /// The nonce and block height stay valid for minutes; a minute keeps well inside that.
    func isFresh(for amount: TokenAmount, to address: String, at now: Date = .now) -> Bool {
        self.amount == amount && self.address == address && now.timeIntervalSince(preparedAt) < 60
    }
}

struct SignedWithdraw: Sendable {
    let actions: [DelegateAction]
    let signatures: [Data]
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

    static func short(_ address: String) -> String {
        address.count > 22 ? "\(address.prefix(10))…\(address.suffix(8))" : address
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

/// Two steps behind one Face ID, both relayed for free: the vault's `withdraw` to the user's own account, then the
/// USDC on to the outside wallet, registering it first when it has never held USDC.
struct RelayedWithdrawals: Withdrawals {
    let api: any FliqAPI
    let rpc: NEARRPC
    let keys: any DeviceKeys
    let owner: @Sendable () async -> String?
    let vault: @Sendable () async -> String?
    var pollInterval: Duration = .seconds(1.5)
    var pollAttempts = 20

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

    func prepare(_ amount: TokenAmount, to typed: String) async throws -> PreparedWithdraw {
        let address = WithdrawAddress.normalized(typed)
        guard amount > .zero, let owner = await owner(), let vault = await vault() else { throw WithdrawError.notSetUp }
        let usdc = try await rpc.vaultUSDC(vault: vault)
        if let problem = WithdrawAddress.problem(address, own: owner, contracts: [vault, usdc]) {
            throw WithdrawError.invalidAddress(problem)
        }
        let publicKey = try keys.publicKey()
        guard let rawKey = NEARKey.decode(publicKey) else { throw WithdrawError.notSetUp }

        async let registered = rpc.isRegistered(address, on: usdc)
        async let block = rpc.finalBlock()
        async let nonce = rpc.accessKeyNonce(account: owner, publicKey: publicKey)
        let registration = try await registered ? nil : try await rpc.registrationCost(on: usdc)
        let header = try await block
        let next = try await nonce + 1
        let units = UInt64(amount.baseUnits)

        var onward: [DelegateAction] = []
        if let registration {
            onward.append(.usdcRegistration(from: owner, for: address, cost: registration, usdc: usdc, nonce: next + 1, blockHeight: header.height, publicKey: rawKey))
        }
        onward.append(.usdcTransfer(from: owner, to: address, units: units, usdc: usdc, nonce: next + 1 + UInt64(onward.count), blockHeight: header.height, publicKey: rawKey))
        let withdraw = DelegateAction.vaultWithdraw(from: owner, units: units, vault: vault, nonce: next, blockHeight: header.height, publicKey: rawKey)
        return PreparedWithdraw(amount: amount, address: address, actions: [withdraw] + onward)
    }

    func sign(_ prepared: PreparedWithdraw) throws -> SignedWithdraw {
        let signatures = try keys.sign(prepared.actions.map(\.signingHash), reason: "Send $\(Money.dollars(prepared.amount)) to \(prepared.address)")
        return SignedWithdraw(actions: prepared.actions, signatures: signatures)
    }

    func deliver(_ signed: SignedWithdraw) async throws -> WithdrawReceipt {
        guard let withdraw = signed.actions.first, let first = signed.signatures.first else { throw WithdrawError.notSetUp }
        let relay = DelegateRelay(api: api, rpc: rpc, keys: keys, pollInterval: pollInterval, pollAttempts: pollAttempts)
        do {
            _ = try await relay.follow(try await api.relay(signedDelegate: withdraw.signed(with: first)))
        } catch TransferError.refused(let reason) {
            throw WithdrawError.refused(reason)
        } catch TransferError.stillPending {
            throw WithdrawError.stillPending
        }

        // Relayed like every other step, so the user's account needs no NEAR for gas.
        var last: RelayResult?
        do {
            for (action, signature) in zip(signed.actions.dropFirst(), signed.signatures.dropFirst()) {
                last = try await relay.follow(try await api.relay(signedDelegate: action.signed(with: signature)))
            }
        } catch {
            throw WithdrawError.notDelivered(String(describing: error))
        }
        return WithdrawReceipt(transactionHash: last?.txHash ?? "")
    }
}

/// The demo build has no chain behind it, so every address is ready and every send lands.
struct FixtureWithdrawals: Withdrawals {
    func check(_ address: String) async -> AddressCheck {
        let address = WithdrawAddress.normalized(address)
        if let problem = WithdrawAddress.problem(address, own: nil, contracts: []) { return .invalid(problem) }
        return .ready(needsSetup: false)
    }

    func prepare(_ amount: TokenAmount, to address: String) async throws -> PreparedWithdraw {
        PreparedWithdraw(amount: amount, address: WithdrawAddress.normalized(address), actions: [])
    }

    func sign(_ prepared: PreparedWithdraw) throws -> SignedWithdraw {
        SignedWithdraw(actions: [], signatures: [])
    }

    func deliver(_ signed: SignedWithdraw) async throws -> WithdrawReceipt {
        WithdrawReceipt(transactionHash: "")
    }
}
