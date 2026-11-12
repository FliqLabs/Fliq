import Foundation

/// Top-ups through the API: `GET /deposits/sources`, `POST /deposits` and `GET /deposits/{id}`.
struct HTTPDepositAPI: DepositAPI {
    let client: HTTPClient

    private struct SourceList: Decodable {
        struct Source: Decodable {
            let token: String
            let chain: String
            let group: String
            let minimum: String
            let etaSeconds: Int
            let direct: Bool
            let available: Bool
            let address: String?
        }

        let sources: [Source]
    }

    struct VaultDeposit: Decodable {
        let depositId: String
        let state: String
        let token: String
        let chain: String
        let address: String
        let memo: String?
        let minimum: String
        let fee: String
        let etaSeconds: Int
        let reservedUntil: Date
        let received: String?
        let landed: String?
        let seenAt: Date?
        let bridgingAt: Date?
        let landedAt: Date?
    }

    private struct DepositRequest: Encodable {
        let token: String
        let chain: String
        let amount: String
    }

    func sources() async throws -> [DepositSource] {
        let list: SourceList = try await client.send("GET", "deposits/sources")
        return list.sources.compactMap { source in
            guard let group = DepositSource.Group(rawValue: source.group) else { return nil }
            return DepositSource(
                tokenId: source.token, chainId: source.chain, group: group,
                minimum: TokenAmount(decimalString: source.minimum), etaSeconds: source.etaSeconds,
                available: source.available, address: source.address
            )
        }
    }

    func reserve(_ source: DepositSource, vault: String) async throws -> DepositAddress {
        if source.isDirect {
            return DepositAddress(
                source: source, address: source.address ?? vault, minimum: source.minimum ?? .zero, fee: .zero,
                reservedUntil: .distantFuture, estimatedSeconds: source.etaSeconds, isDemo: false
            )
        }
        // The address takes any amount from its minimum up, so the smallest top-up is what gets quoted.
        let amount = (source.minimum ?? TokenAmount(baseUnits: TokenAmount.base)).decimalString
        do {
            let deposit: VaultDeposit = try await client.send(
                "POST", "deposits",
                body: DepositRequest(token: source.tokenId, chain: source.chainId, amount: amount),
                headers: ["Idempotency-Key": UUID().uuidString]
            )
            return Self.address(deposit, source: source)
        } catch APIError.server(let status, let error) where status == 503 || status == 400 {
            throw DepositUnavailable(message: error.message)
        }
    }

    func status(of deposit: DepositAddress) async throws -> DepositStatus {
        guard let id = deposit.depositId else {
            return DepositStatus(stage: .waiting, received: nil, seenAt: nil, bridgingAt: nil, landedAt: nil)
        }
        let live: VaultDeposit = try await client.send("GET", "deposits/\(id)")
        return Self.status(live)
    }

    static func address(_ deposit: VaultDeposit, source: DepositSource) -> DepositAddress {
        DepositAddress(
            source: source, depositId: deposit.depositId, address: deposit.address, memo: deposit.memo,
            minimum: TokenAmount(decimalString: deposit.minimum) ?? .zero,
            fee: TokenAmount(decimalString: deposit.fee) ?? .zero,
            reservedUntil: deposit.reservedUntil, estimatedSeconds: deposit.etaSeconds, isDemo: false
        )
    }

    static func status(_ deposit: VaultDeposit) -> DepositStatus {
        let stage: DepositStatus.Stage = switch deposit.state {
        case "seen": .seen
        case "underpaid": .underpaid
        case "bridging": .bridging
        case "landed": .landed
        case "refunded": .refunded
        case "expired": .expired
        case "failed": .failed
        default: .waiting
        }
        return DepositStatus(
            stage: stage, received: deposit.received.flatMap(TokenAmount.init(decimalString:)),
            seenAt: deposit.seenAt, bridgingAt: deposit.bridgingAt, landedAt: deposit.landedAt,
            landed: deposit.landed.flatMap(TokenAmount.init(decimalString:))
        )
    }
}
