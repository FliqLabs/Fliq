import Foundation

/// Asking to be paid: a link anyone can pay from any chain, from `POST /requests`.
struct PaymentRequest: Codable, Sendable, Equatable, Identifiable {
    enum State: String, Codable, Sendable {
        case open, paid, cancelled
    }

    struct Payment: Codable, Sendable, Equatable {
        let paidAt: Date
        let payer: String?
        let token: String
        let chain: String
        let amount: String
        let landed: String
    }

    let requestId: String
    let code: String
    let link: String
    let amount: String
    let note: String
    let state: State
    let cashOutOnArrival: Bool
    let createdAt: Date
    let paid: Payment?

    var id: String { requestId }
}

struct PaymentRequestInput: Encodable, Sendable, Equatable {
    let amount: String
    let note: String
    let cashOutOnArrival: Bool
}
