import Foundation

/// Money a deposit route sent back to the user's NEAR Intents balance, from `GET /refunds`. It is the user's, but
/// outside the vault until they bring it back.
struct Refund: Decodable, Equatable, Identifiable, Sendable {
    let tokenId: String
    let symbol: String
    let chain: String
    /// Base units of the token, as a string: an 18-decimal token does not fit in 64 bits.
    let units: String
    /// The same amount as a decimal string in the token's own decimals, which for a dollar token is dollars.
    let amount: String
    let intentsContract: String

    var id: String { tokenId }
    var dollars: TokenAmount { TokenAmount(decimalString: amount) ?? .zero }

    /// Faiz's ₦2,500 bank deposit, refunded by 1Click on 17 Nov, for UI tests.
    static let sample = Refund(
        tokenId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", symbol: "usdc", chain: "solana",
        units: "1632606", amount: "1.632606", intentsContract: "intents.near"
    )
}

struct RefundList: Decodable, Sendable {
    let items: [Refund]
}

/// The 1Click route the API opened to carry a refund back into the vault, from `POST /refunds/return`.
struct ReturnedRefund: Decodable, Equatable, Sendable {
    let depositId: String
    let depositAddress: String
    let tokenId: String
    let units: String
    let lands: String
    let intentsContract: String
}
