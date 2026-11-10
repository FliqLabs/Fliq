import Foundation

/// The NEAR network the app's API runs on. Receiving from other chains goes through NEAR Intents, which only runs
/// on mainnet, so on testnet only the user's own NEAR account can receive.
enum NearNetwork: String, Sendable {
    case testnet, mainnet

    static let current = from(Bundle.main.infoDictionary ?? [:])

    static func from(_ info: [String: Any]) -> NearNetwork {
        if let named = (info["FliqNearNetwork"] as? String).flatMap(NearNetwork.init(rawValue:)) { return named }
        let rpc = info["FliqNearRPCURL"] as? String ?? ""
        return rpc.contains("testnet") ? .testnet : .mainnet
    }

    var receivesFromOtherChains: Bool { self == .mainnet }
}
