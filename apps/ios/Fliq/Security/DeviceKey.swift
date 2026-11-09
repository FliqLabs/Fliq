import CryptoKit
import Foundation
import LocalAuthentication
import Security

/// The ed25519 key that owns the user's NEAR account. A passkey cannot be this key: passkeys are
/// P-256 and NEAR access keys are ed25519. The key is made on the phone and never leaves it.
protocol DeviceKeys: Sendable {
    /// The public half as NEAR writes it, `ed25519:<base58>`. The key is made on first use.
    func publicKey() throws -> String
    /// Asks for Face ID or the passcode, then signs with the private half.
    func sign(_ message: Data, reason: String) throws -> Data
}

extension DeviceKeys {
    func sign(_ message: Data, reason: String) throws -> Data { throw KeychainError(status: errSecUnimplemented) }
}

struct KeychainDeviceKeys: DeviceKeys {
    var service = "cash.fliq.near-key"

    private var publicStore: Keychain { Keychain(service: service) }

    func publicKey() throws -> String {
        if let saved = publicStore.load(String.self, for: "public") { return saved }
        let key = Curve25519.Signing.PrivateKey()
        try savePrivate(key.rawRepresentation)
        let encoded = NEARKey.encode(key.publicKey.rawRepresentation)
        try publicStore.save(encoded, for: "public")
        return encoded
    }

    /// The Keychain releases the private key only after Face ID or the device passcode.
    func sign(_ message: Data, reason: String) throws -> Data {
        let context = LAContext()
        context.localizedReason = reason
        var query = privateQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationContext as String] = context
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let raw = result as? Data else { throw KeychainError(status: status) }
        return try Curve25519.Signing.PrivateKey(rawRepresentation: raw).signature(for: message)
    }

    private func savePrivate(_ raw: Data) throws {
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, .userPresence, &error) else {
            throw KeychainError(status: errSecParam)
        }
        SecItemDelete(privateQuery as CFDictionary)
        var item = privateQuery
        item[kSecValueData as String] = raw
        item[kSecAttrAccessControl as String] = access
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }

    private var privateQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "private"]
    }
}

enum NEARKey {
    static func encode(_ publicKey: Data) -> String {
        "ed25519:" + base58(publicKey)
    }

    private static let alphabet = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")

    /// The raw 32 bytes of an `ed25519:<base58>` key.
    static func decode(_ encoded: String) -> Data? {
        guard encoded.hasPrefix("ed25519:") else { return nil }
        var bytes: [UInt8] = []
        for character in encoded.dropFirst("ed25519:".count) {
            guard var carry = alphabet.firstIndex(of: character) else { return nil }
            for index in bytes.indices {
                carry += Int(bytes[index]) * 58
                bytes[index] = UInt8(carry & 0xFF)
                carry >>= 8
            }
            while carry > 0 {
                bytes.append(UInt8(carry & 0xFF))
                carry >>= 8
            }
        }
        let zeros = encoded.dropFirst("ed25519:".count).prefix { $0 == "1" }.count
        let raw = Data(repeating: 0, count: zeros) + Data(bytes.reversed())
        return raw.count == 32 ? raw : nil
    }

    static func base58(_ bytes: Data) -> String {
        var digits: [Int] = []
        for byte in bytes {
            var carry = Int(byte)
            for index in digits.indices {
                carry += digits[index] << 8
                digits[index] = carry % 58
                carry /= 58
            }
            while carry > 0 {
                digits.append(carry % 58)
                carry /= 58
            }
        }
        let zeros = bytes.prefix { $0 == 0 }.count
        return String(repeating: "1", count: zeros) + String(digits.reversed().map { alphabet[$0] })
    }
}
