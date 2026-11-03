import Foundation

/// Stands in until the API can reserve NEAR Intents deposit addresses. Addresses it returns
/// are marked demo and must never be funded: nothing watches them.
struct FixtureDepositAPI: DepositAPI {
    static let fee = TokenAmount(baseUnits: 20_000)
    static let watchWindow: TimeInterval = 10 * 60

    private let clock = DepositClock()

    func sources() async throws -> [DepositSource] {
        [
            DepositSource(token: "USDC", chain: "Base", group: .dollars),
            DepositSource(token: "USDC", chain: "Solana", group: .dollars),
            DepositSource(token: "USDT", chain: "Tron", group: .dollars, minimum: TokenAmount(baseUnits: 100_000_000)),
            DepositSource(token: "USDC", chain: "Arbitrum", group: .dollars),
            DepositSource(token: "USDC", chain: "Ethereum", group: .dollars, note: "Ethereum · Polygon"),
            DepositSource(token: "BTC", chain: "Bitcoin", group: .bitcoin, note: "Lands as dollars · about 10 min"),
            DepositSource(token: "USDC", chain: "NEAR", group: .near, note: "NEAR · your vault address"),
        ]
    }

    func reserve(_ source: DepositSource, expected: TokenAmount, vault: String) async throws -> DepositAddress {
        let fee = source.isDirect ? .zero : Self.fee
        let lands = TokenAmount(baseUnits: max(0, expected.baseUnits - fee.baseUnits))
        let deposit = DepositAddress(
            source: source,
            address: source.isDirect ? vault : Self.demoAddress(for: source.chain),
            expected: expected,
            lands: lands,
            fee: fee,
            reservedUntil: .now.addingTimeInterval(Self.watchWindow),
            estimatedSeconds: source.group == .bitcoin ? 600 : 35,
            isDemo: true
        )
        await clock.start(deposit.address)
        return deposit
    }

    /// Plays the arrival the way the demo script shows it: seen, then bridging, then landed.
    func status(of deposit: DepositAddress) async throws -> DepositStatus {
        let polls = await clock.poll(deposit.address)
        let now = Date.now
        let stage: DepositStatus.Stage = switch polls {
        case ..<2: .waiting
        case 2: .seen
        case 3: .bridging
        default: .landed
        }
        return DepositStatus(
            stage: stage,
            received: stage >= .seen ? deposit.expected : nil,
            seenAt: stage >= .seen ? now.addingTimeInterval(-7) : nil,
            bridgingAt: stage >= .bridging ? now : nil,
            landedAt: stage >= .landed ? now : nil
        )
    }

    private static func demoAddress(for chain: String) -> String {
        switch chain {
        case "Solana": "DEMO1111111111111111111111111111111111111111"
        case "Tron": "TDEMO11111111111111111111111111111"
        case "Bitcoin": "bc1qdemo0000000000000000000000000000000000"
        default: "0xDEMO000000000000000000000000000000000000"
        }
    }
}

private actor DepositClock {
    private var polls: [String: Int] = [:]

    func start(_ address: String) { polls[address] = 0 }

    func poll(_ address: String) -> Int {
        let next = (polls[address] ?? 0) + 1
        polls[address] = next
        return next
    }
}
