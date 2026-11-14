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

enum RecoveryError: Error, Equatable {
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

    private func add(_ key: Data, to account: String, signedBy signer: any DeviceKeys, reason: String) async throws {
        let relay = DelegateRelay(api: api, rpc: rpc, keys: signer, pollInterval: pollInterval)
        _ = try await relay.submitDelegate(from: account, reason: reason) { nonce, height, signerKey in
            KeyDelegate(account: account, change: .add(key), nonce: nonce, maxBlockHeight: height + DelegateAction.lifetimeBlocks, publicKey: signerKey)
        }
    }
}

/// The sample-data build: a backup that works at once, and an iPhone that can always sign unless told otherwise.
actor FixtureAccountRecovery: AccountRecovering {
    private var current: RecoveryState

    init(_ state: RecoveryState = .notBackedUp) {
        current = state
    }

    func state() async -> RecoveryState? { current }

    func backUp() async throws { current = .backedUp }

    func restore() async throws {
        guard current == .canRestore else { throw RecoveryError.noBackup }
        current = .backedUp
    }
}
