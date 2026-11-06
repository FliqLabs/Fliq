import Foundation
import Security

/// Small Codable values in the Keychain, readable only while the device is unlocked.
struct Keychain: Sendable {
    let service: String

    func save<Value: Encodable>(_ value: Value, for key: String) throws {
        let data = try JSONEncoder().encode(value)
        let query = base(key)
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }

    func load<Value: Decodable>(_ type: Value.Type, for key: String) -> Value? {
        var query = base(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    func delete(_ key: String) {
        SecItemDelete(base(key) as CFDictionary)
    }

    private func base(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
    }
}

struct KeychainError: Error, Equatable {
    let status: OSStatus
}
