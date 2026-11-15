import Foundation

/// Where this iPhone and the account's backup stand.
enum RecoveryState: Equatable, Sendable, Identifiable {
    var id: Self { self }

    /// This iPhone can move money, and nothing else can: lose it and the balance is unreachable.
    case notBackedUp
    /// This iPhone can move money and a backup key is on the account.
    case backedUp
    /// This iPhone cannot move money yet, but the backup is here and can add it.
    case canRestore
    /// This iPhone cannot move money and has no backup to add it with.
    case cannotSign
}

/// A key that can move the account's money, and what holds it.
struct AccountKey: Equatable, Identifiable, Sendable {
    enum Holder: Equatable, Sendable {
        case thisIPhone
        case backup
        /// Another iPhone, or anything else that was given a key.
        case other
    }

    let publicKey: String
    let holder: Holder

    var id: String { publicKey }
}

enum RecoveryError: Error, Equatable {
    case cannotRemoveThisIPhone
    case noAccount
    case notApproved
    case noBackup
}

protocol AccountRecovering: Sendable {
    /// Nil when the chain cannot be read, so the app never guesses.
    func state() async -> RecoveryState?
    /// Puts the backup key on the account, signed by this iPhone's key.
    func backUp() async throws
    /// Puts this iPhone's key on the account, signed by the backup key.
    func restore() async throws
    /// Every key that can move the account's money, this iPhone first. Nil when the chain cannot be read.
    func keys() async -> [AccountKey]?
    /// Takes a key off the account, signed by this iPhone's key. Removing the backup also forgets it.
    func remove(_ key: AccountKey) async throws
}

struct AccountRecovery: AccountRecovering {
    let api: any FliqAPI
    let rpc: NEARRPC
    let device: any DeviceKeys
    let recovery: any RecoveryKeys
    let biometrics: any Biometrics
    let account: @Sendable () async -> String?
    var pollInterval: Duration = .seconds(1.5)

    func state() async -> RecoveryState? {
        guard let account = await account(), let deviceKey = try? device.publicKey() else { return nil }
        do {
            let deviceOn = try await rpc.hasAccessKey(account: account, publicKey: deviceKey)
            var backupOn = false
            if let backup = recovery.existing(for: account) {
                backupOn = try await rpc.hasAccessKey(account: account, publicKey: backup.publicKey())
            }
            switch (deviceOn, backupOn) {
            case (true, true): return .backedUp
            case (true, false): return .notBackedUp
            case (false, true): return .canRestore
            case (false, false): return .cannotSign
            }
        } catch {
            return nil
        }
    }

    func backUp() async throws {
        guard let account = await account() else { throw RecoveryError.noAccount }
        let backup = try recovery.key(for: account)
        guard let added = NEARKey.decode(try backup.publicKey()) else { throw RecoveryError.noBackup }
        try await add(added, to: account, signedBy: device, reason: "Back up your fliq account")
    }

    func restore() async throws {
        guard let account = await account() else { throw RecoveryError.noAccount }
        guard let backup = recovery.existing(for: account) else { throw RecoveryError.noBackup }
        guard let added = NEARKey.decode(try device.publicKey()) else { throw RecoveryError.noBackup }
        // The backup key is not behind the Keychain's Face ID, so the app asks before it signs.
        guard await biometrics.approve("Add this iPhone to your fliq account") else { throw RecoveryError.notApproved }
        try await add(added, to: account, signedBy: backup, reason: "Add this iPhone to your fliq account")
    }

    func keys() async -> [AccountKey]? {
        guard let account = await account(), let deviceKey = try? device.publicKey(),
              let onChain = try? await rpc.fullAccessKeys(account: account) else { return nil }
        let backupKey = try? recovery.existing(for: account)?.publicKey()
        let all = onChain.map { key in
            AccountKey(publicKey: key, holder: key == deviceKey ? .thisIPhone : key == backupKey ? .backup : .other)
        }
        let order: [AccountKey.Holder] = [.thisIPhone, .backup, .other]
        return all.sorted { (order.firstIndex(of: $0.holder) ?? 0, $0.publicKey) < (order.firstIndex(of: $1.holder) ?? 0, $1.publicKey) }
    }

    func remove(_ key: AccountKey) async throws {
        guard key.holder != .thisIPhone else { throw RecoveryError.cannotRemoveThisIPhone }
        guard let account = await account() else { throw RecoveryError.noAccount }
        guard let removed = NEARKey.decode(key.publicKey) else { throw RecoveryError.noBackup }
        try await change(.remove(removed), on: account, signedBy: device, reason: key.holder == .backup ? "Turn off account backup" : "Remove a device from your account")
        if key.holder == .backup { recovery.delete(for: account) }
    }

    private func add(_ key: Data, to account: String, signedBy signer: any DeviceKeys, reason: String) async throws {
        try await change(.add(key), on: account, signedBy: signer, reason: reason)
    }

    private func change(_ change: KeyDelegate.Change, on account: String, signedBy signer: any DeviceKeys, reason: String) async throws {
        let relay = DelegateRelay(api: api, rpc: rpc, keys: signer, pollInterval: pollInterval)
        _ = try await relay.submitDelegate(from: account, reason: reason) { nonce, height, signerKey in
            KeyDelegate(account: account, change: change, nonce: nonce, maxBlockHeight: height + DelegateAction.lifetimeBlocks, publicKey: signerKey)
        }
    }
}

/// The sample-data build: a backup that works at once, and an iPhone that can always sign unless told otherwise.
actor FixtureAccountRecovery: AccountRecovering {
    private var current: RecoveryState
    private var others: [AccountKey]

    init(_ state: RecoveryState = .notBackedUp, otherDevices: Int = 0) {
        current = state
        others = (0..<otherDevices).map { AccountKey(publicKey: "ed25519:other\($0)", holder: .other) }
    }

    func state() async -> RecoveryState? { current }

    func backUp() async throws { current = .backedUp }

    func restore() async throws {
        guard current == .canRestore else { throw RecoveryError.noBackup }
        current = .backedUp
    }

    func keys() async -> [AccountKey]? {
        var all: [AccountKey] = []
        if current == .notBackedUp || current == .backedUp { all.append(AccountKey(publicKey: "ed25519:this", holder: .thisIPhone)) }
        if current == .backedUp || current == .canRestore { all.append(AccountKey(publicKey: "ed25519:backup", holder: .backup)) }
        return all + others
    }

    func remove(_ key: AccountKey) async throws {
        switch key.holder {
        case .thisIPhone: throw RecoveryError.cannotRemoveThisIPhone
        case .backup: current = .notBackedUp
        case .other: others.removeAll { $0 == key }
        }
    }
}
