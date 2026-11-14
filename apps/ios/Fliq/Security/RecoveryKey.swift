import CryptoKit
import Foundation
import Security

/// The second key on the user's NEAR account. It is kept in iCloud Keychain, so it follows the user to a new iPhone
/// signed in to the same Apple ID, where it adds that iPhone's own key to the account.
protocol RecoveryKeys: Sendable {
    /// The key this Apple ID holds for `account`, if any.
    func existing(for account: String) -> (any DeviceKeys)?
    /// The key for `account`, made and stored on first use.
    func key(for account: String) throws -> any DeviceKeys
}

struct KeychainRecoveryKeys: RecoveryKeys {
    var service = "cash.fliq.recovery-key"
    var network = NearNetwork.current

    func existing(for account: String) -> (any DeviceKeys)? {
        load(account).map(RecoveryKey.init)
    }

    func key(for account: String) throws -> any DeviceKeys {
        if let saved = load(account) { return RecoveryKey(key: saved) }
        let key = Curve25519.Signing.PrivateKey()
        var item = query(account)
        item[kSecValueData as String] = key.rawRepresentation
        // A synced item cannot be bound to this device or to Face ID. The app asks for Face ID before using it.
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError(status: status) }
        return RecoveryKey(key: key)
    }

    private func load(_ account: String) -> Curve25519.Signing.PrivateKey? {
        var query = query(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let raw = result as? Data else { return nil }
        return try? Curve25519.Signing.PrivateKey(rawRepresentation: raw)
    }

    private func query(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "\(network.rawValue):\(account)",
            kSecAttrSynchronizable as String: true,
        ]
    }
}

/// Signs with a key held in memory. The Face ID check for a recovery key is the app's, made before this is called.
struct RecoveryKey: DeviceKeys {
    let key: Curve25519.Signing.PrivateKey

    func publicKey() throws -> String { NEARKey.encode(key.publicKey.rawRepresentation) }
    func sign(_ message: Data, reason: String) throws -> Data { try key.signature(for: message) }
    func sign(_ messages: [Data], reason: String) throws -> [Data] { try messages.map { try key.signature(for: $0) } }
}

/// Keeps recovery keys in memory, for tests and the sample-data build.
final class MemoryRecoveryKeys: RecoveryKeys, @unchecked Sendable {
    private let lock = NSLock()
    private var keys: [String: Curve25519.Signing.PrivateKey] = [:]

    func existing(for account: String) -> (any DeviceKeys)? {
        lock.withLock { keys[account] }.map(RecoveryKey.init)
    }

    func key(for account: String) throws -> any DeviceKeys {
        lock.withLock {
            let key = keys[account] ?? Curve25519.Signing.PrivateKey()
            keys[account] = key
            return RecoveryKey(key: key)
        }
    }
}
