import Foundation

/// One page of `GET /activity`: everything that moved money for the user, newest first.
struct ActivityList: Decodable, Sendable {
    let items: [ActivityItem]
    let nextCursor: String?
}

struct ActivityItem: Decodable, Identifiable, Equatable, Sendable {
    enum Kind: String, Decodable, Sendable {
        case payout, deposit, refused, unknown
        case transferIn = "transfer_in"
        case transferOut = "transfer_out"

        init(from decoder: Decoder) throws {
            self = Kind(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
        }
    }

    struct Party: Decodable, Equatable, Sendable {
        let name: String
        let nearAccount: String?
        let institution: String?
        let accountLast4: String?
        let photoUrl: String?
    }

    struct Agent: Decodable, Equatable, Sendable {
        let agentId: String
        let name: String
    }

    struct Local: Decodable, Equatable, Sendable {
        let amount: String
        let currency: String
    }

    let activityId: String
    let kind: Kind
    let status: String
    let at: Date
    let party: Party
    let provider: String?
    let agent: Agent?
    let local: Local?
    let usd: String?
    let token: String?
    let seconds: Int?
    let reason: String?
    let refId: String
    /// The NEAR transaction behind the row, for the receipt's explorer link. Only transfers have one.
    var txHash: String? = nil

    var id: String { activityId }
}

extension ActivityItem {
    static let bankPartyName = "From your bank"

    var isBankDeposit: Bool { kind == .deposit && party.name == Self.bankPartyName }

    static func bankDeposit(
        _ deposit: ActivityStore.BankDeposit, status: String, landed: String? = nil, seconds: Int? = nil, at: Date? = nil, activityId: String? = nil
    ) -> ActivityItem {
        ActivityItem(
            activityId: activityId ?? "bank-" + deposit.depositId,
            kind: .deposit,
            status: status,
            at: at ?? deposit.startedAt,
            party: Party(name: bankPartyName, nearAccount: nil, institution: nil, accountLast4: nil, photoUrl: nil),
            provider: "paj",
            agent: nil,
            local: Local(amount: String(deposit.naira), currency: "NGN"),
            usd: landed ?? deposit.usd,
            token: Money.local(deposit.naira, .ngn),
            seconds: seconds,
            reason: nil,
            refId: deposit.depositId
        )
    }
}
