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

    var id: String { activityId }
}
