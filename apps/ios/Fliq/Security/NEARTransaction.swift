import CryptoKit
import Foundation

/// A plain NEAR transaction the phone signs and sends itself. Used where the relayer has no rule, such as moving
/// USDC from the user's own account to an address outside fliq; the user's account pays the small gas fee.
struct NEARTransaction: Equatable, Sendable {
    let signerId: String
    /// The raw 32 byte ed25519 public key.
    let publicKey: Data
    let nonce: UInt64
    let receiverId: String
    /// The raw 32 bytes of a recent block hash.
    let blockHash: Data
    let calls: [DelegateAction.FunctionCall]

    private static let functionCallAction: UInt8 = 2
    private static let ed25519: UInt8 = 0

    var borsh: Data {
        var writer = BorshWriter()
        writer.string(signerId)
        writer.u8(Self.ed25519)
        writer.raw(publicKey)
        writer.u64(nonce)
        writer.string(receiverId)
        writer.raw(blockHash)
        writer.u32(UInt32(calls.count))
        for call in calls {
            writer.u8(Self.functionCallAction)
            writer.string(call.methodName)
            writer.bytes(call.args)
            writer.u64(call.gas)
            writer.u128(call.deposit)
        }
        return writer.data
    }

    var signingHash: Data { Data(SHA256.hash(data: borsh)) }

    /// The Borsh `SignedTransaction` that the RPC's `send_tx` takes, base64 encoded.
    func signed(with signature: Data) -> String {
        var writer = BorshWriter()
        writer.raw(borsh)
        writer.u8(Self.ed25519)
        writer.raw(signature)
        return writer.data.base64EncodedString()
    }
}

extension NEARTransaction {
    /// Sends USDC from the signer's own account. When the receiver has never held this token, the same
    /// transaction pays its storage registration first, otherwise the token contract refuses the transfer.
    static func usdcTransfer(
        from sender: String,
        to receiver: String,
        units: UInt64,
        usdc: String,
        registration: Yocto?,
        nonce: UInt64,
        blockHash: Data,
        publicKey: Data
    ) -> NEARTransaction {
        var calls: [DelegateAction.FunctionCall] = []
        if let registration {
            calls.append(.init(
                methodName: "storage_deposit",
                args: Data(#"{"account_id":"\#(receiver)","registration_only":true}"#.utf8),
                gas: 10_000_000_000_000,
                deposit: registration
            ))
        }
        calls.append(.init(
            methodName: "ft_transfer",
            args: Data(#"{"receiver_id":"\#(receiver)","amount":"\#(units)","memo":"fliq"}"#.utf8),
            gas: 20_000_000_000_000,
            deposit: 1
        ))
        return NEARTransaction(
            signerId: sender, publicKey: publicKey, nonce: nonce, receiverId: usdc, blockHash: blockHash, calls: calls
        )
    }
}
