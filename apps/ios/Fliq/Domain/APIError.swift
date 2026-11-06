import Foundation

struct ErrorBody: Codable, Sendable, Equatable {
    struct Detail: Codable, Sendable, Equatable {
        let code: String
        let message: String
    }

    let error: Detail
}

struct Refusal: Codable, Sendable, Equatable {
    let error: ErrorBody.Detail
    let attempted: Int
    let perPayoutCap: Int
    let dailyCap: Int
    let usedToday: Int
}

enum APIError: Error, Equatable {
    case refused(Refusal)
    case server(status: Int, ErrorBody.Detail)
    case unexpected(status: Int)
}
