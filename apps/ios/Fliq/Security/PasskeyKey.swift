import CryptoKit
import Foundation

/// The NEAR key a passkey makes with the WebAuthn PRF extension. fliq.cash makes the same key from the same passkey,
/// so once it is on the account, any browser or iPhone with that passkey can add itself without a backup.
struct PasskeyKey: DeviceKeys {
    static let label = "fliq near key v1"
    /// What the passkey is asked to sign. Fixed, so the same passkey always gives the same secret.
    static var salt: Data { Data(SHA256.hash(data: Data(label.utf8))) }

    private let key: Curve25519.Signing.PrivateKey

    init(prf: SymmetricKey) throws {
        let seed = HKDF<SHA256>.deriveKey(inputKeyMaterial: prf, salt: Data(), info: Data(Self.label.utf8), outputByteCount: 32)
        key = try seed.withUnsafeBytes { try Curve25519.Signing.PrivateKey(rawRepresentation: Data($0)) }
    }

    func publicKey() throws -> String { NEARKey.encode(key.publicKey.rawRepresentation) }

    /// The passkey sheet already asked for Face ID, so this signs at once.
    func sign(_ message: Data, reason: String) throws -> Data { try key.signature(for: message) }

    func sign(_ messages: [Data], reason: String) throws -> [Data] { try messages.map { try key.signature(for: $0) } }
}
