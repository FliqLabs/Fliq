import CryptoKit
import Foundation

/// A NEP-366 delegate action: one call the user signs on the phone, which the relayer submits and pays gas for.
struct DelegateAction: Equatable, Sendable {
    struct FunctionCall: Equatable, Sendable {
        let methodName: String
        let args: Data
        let gas: UInt64
        let deposit: UInt64
    }

    let senderId: String
    let receiverId: String
    let call: FunctionCall
    let nonce: UInt64
    let maxBlockHeight: UInt64
    /// The raw 32 byte ed25519 public key.
    let publicKey: Data

    /// NEP-461 puts this before the action, so a signed delegate can never be replayed as a transaction.
    private static let signingPrefix = UInt32(1 << 30) + 366
    private static let functionCallAction: UInt8 = 2
    private static let ed25519: UInt8 = 0

    var borsh: Data {
        var writer = BorshWriter()
        writer.string(senderId)
        writer.string(receiverId)
        writer.u32(1)
        writer.u8(Self.functionCallAction)
        writer.string(call.methodName)
        writer.bytes(call.args)
        writer.u64(call.gas)
        writer.u128(call.deposit)
        writer.u64(nonce)
        writer.u64(maxBlockHeight)
        writer.u8(Self.ed25519)
        writer.raw(publicKey)
        return writer.data
    }

    /// What the device key signs: sha256 of the prefix and the action.
    var signingHash: Data {
        var writer = BorshWriter()
        writer.u32(Self.signingPrefix)
        writer.raw(borsh)
        return Data(SHA256.hash(data: writer.data))
    }

    /// The Borsh `SignedDelegate` that `POST /relays` takes, base64 encoded.
    func signed(with signature: Data) -> String {
        var writer = BorshWriter()
        writer.raw(borsh)
        writer.u8(Self.ed25519)
        writer.raw(signature)
        return writer.data.base64EncodedString()
    }
}

extension DelegateAction {
    /// The relayer only passes about ten minutes of blocks, and refuses more than 1,200.
    static let lifetimeBlocks: UInt64 = 600

    /// Vault to vault between fliq users. The vault takes exactly one yoctoNEAR, so only the owner's full-access key can move money.
    static func vaultTransfer(from sender: String, to recipient: String, units: UInt64, vault: String, nonce: UInt64, blockHeight: UInt64, publicKey: Data) -> DelegateAction {
        let args = Data(#"{"to_account":"\#(recipient)","amount":"\#(units)"}"#.utf8)
        return DelegateAction(
            senderId: sender,
            receiverId: vault,
            call: FunctionCall(methodName: "transfer", args: args, gas: 30_000_000_000_000, deposit: 1),
            nonce: nonce,
            maxBlockHeight: blockHeight + lifetimeBlocks,
            publicKey: publicKey
        )
    }
}

/// Little-endian Borsh, enough for a delegate action.
struct BorshWriter {
    private(set) var data = Data()

    mutating func u8(_ value: UInt8) { data.append(value) }
    mutating func u32(_ value: UInt32) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
    mutating func u64(_ value: UInt64) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
    mutating func u128(_ value: UInt64) {
        u64(value)
        u64(0)
    }
    mutating func raw(_ bytes: Data) { data.append(bytes) }
    mutating func bytes(_ bytes: Data) {
        u32(UInt32(bytes.count))
        data.append(bytes)
    }
    mutating func string(_ value: String) { bytes(Data(value.utf8)) }
}
