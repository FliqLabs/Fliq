import Foundation

/// Paj Cash turns a Naira bank transfer into USDC on Solana. The app talks to Paj with the user's own Paj session;
/// only the sign-in step needs fliq's business key, so that goes through fliq's web server (`/api/paj/...`).
enum Paj {
    /// USDC on Solana, the token Paj delivers.
    static let usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

    struct Quote: Equatable, Sendable {
        let naira: Int
        let usdc: Double
        let rate: Double
    }

    struct Order: Equatable, Sendable, Identifiable {
        enum Status: String, Sendable {
            case initiated = "INIT"
            case paid = "PAID"
            case completed = "COMPLETED"
            case failed = "FAILED"
            case cancelled = "CANCELLED"
            case unknown
        }

        let id: String
        let naira: Int
        let usdc: Double
        let rate: Double
        let accountNumber: String
        let accountName: String
        let bank: String
        var status: Status
        var signature: String?
    }

    struct Session: Codable, Equatable, Sendable {
        let token: String
        let expiresAt: Date
        let contact: String

        func isValid(at now: Date = .now) -> Bool { expiresAt > now.addingTimeInterval(60) }
    }

    struct Failure: Error, Equatable {
        let message: String
    }
}

protocol PajAPI: Sendable {
    func publicRate() async throws -> Double
    func quote(naira: Int, session: Paj.Session) async throws -> Paj.Quote
    func createOrder(naira: Int, recipient: String, session: Paj.Session) async throws -> Paj.Order
    func order(_ id: String, session: Paj.Session) async throws -> Paj.Order
}

/// Starts and finishes a Paj sign-in through fliq's server, which holds the business key.
protocol PajSignIn: Sendable {
    func sendCode(to contact: String) async throws
    func verify(_ contact: String, code: String) async throws -> Paj.Session
}

struct HTTPPaj: PajAPI {
    var base = URL(string: "https://api.paj.cash")!
    var session: URLSession = .shared

    func publicRate() async throws -> Double {
        struct Reply: Decodable {
            struct Rate: Decodable { let rate: Double }
            let onRampRate: Rate
        }
        let reply: Reply = try await get("pub/rate", query: [:], token: nil)
        return reply.onRampRate.rate
    }

    func quote(naira: Int, session: Paj.Session) async throws -> Paj.Quote {
        struct Reply: Decodable {
            let fiatAmount: Double
            let amount: Double
            let rate: Double
        }
        let reply: Reply = try await get(
            "pub/rates/onramp-value",
            query: ["fiatAmount": String(naira), "mint": Paj.usdcMint, "currency": "NGN"],
            token: session.token
        )
        return Paj.Quote(naira: Int(reply.fiatAmount), usdc: reply.amount, rate: reply.rate)
    }

    func createOrder(naira: Int, recipient: String, session: Paj.Session) async throws -> Paj.Order {
        let body: [String: Any] = [
            "fiatAmount": naira, "currency": "NGN", "recipient": recipient, "mint": Paj.usdcMint, "chain": "SOLANA",
        ]
        let reply: OrderReply = try await send("POST", "pub/onramp", body: body, token: session.token)
        return reply.order
    }

    func order(_ id: String, session: Paj.Session) async throws -> Paj.Order {
        let reply: OrderReply = try await get("pub/transactions/\(id)", query: [:], token: session.token)
        return reply.order
    }

    private struct OrderReply: Decodable {
        let id: String
        let fiatAmount: Double
        let amount: Double
        let rate: Double
        let accountNumber: String?
        let accountName: String?
        let bank: String?
        let status: String
        let signature: String?

        var order: Paj.Order {
            Paj.Order(
                id: id, naira: Int(fiatAmount), usdc: amount, rate: rate,
                accountNumber: accountNumber ?? "", accountName: accountName ?? "", bank: bank ?? "",
                status: Paj.Order.Status(rawValue: status) ?? .unknown, signature: signature
            )
        }
    }

    private func get<Reply: Decodable>(_ path: String, query: [String: String], token: String?) async throws -> Reply {
        var components = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) } }
        var request = URLRequest(url: components.url!)
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return try await perform(request)
    }

    private func send<Reply: Decodable>(_ method: String, _ path: String, body: [String: Any], token: String) async throws -> Reply {
        var request = URLRequest(url: base.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await perform(request)
    }

    private func perform<Reply: Decodable>(_ request: URLRequest) async throws -> Reply {
        var request = request
        request.timeoutInterval = 20
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw Paj.Failure(message: PajMessage.from(data)) }
        return try JSONDecoder().decode(Reply.self, from: data)
    }
}

/// `POST /api/paj/initiate` and `/api/paj/verify` on fliq's web server, signed with the user's fliq session.
struct WebPajSignIn: PajSignIn {
    let base: URL
    let bearer: @Sendable () async -> String?
    var deviceID: String
    var session: URLSession = .shared

    func sendCode(to contact: String) async throws {
        struct Ignored: Decodable {}
        let _: Ignored = try await post("api/paj/initiate", body: Self.contactField(contact))
    }

    func verify(_ contact: String, code: String) async throws -> Paj.Session {
        struct Reply: Decodable {
            let token: String
            let expiresAt: String
        }
        var body = Self.contactField(contact)
        body["otp"] = code
        body["device"] = ["uuid": deviceID, "device": "iPhone", "os": "iOS"]
        let reply: Reply = try await post("api/paj/verify", body: body)
        let expires = (try? Date(reply.expiresAt, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true))) ?? .now.addingTimeInterval(86_400)
        return Paj.Session(token: reply.token, expiresAt: expires, contact: contact)
    }

    static func contactField(_ contact: String) -> [String: Any] {
        contact.contains("@") ? ["email": contact] : ["phone": contact]
    }

    private func post<Reply: Decodable>(_ path: String, body: [String: Any]) async throws -> Reply {
        guard let token = await bearer() else { throw Paj.Failure(message: "Sign in to fliq again first.") }
        var request = URLRequest(url: base.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw Paj.Failure(message: PajMessage.from(data)) }
        return try JSONDecoder().decode(Reply.self, from: data)
    }
}

/// The Paj session lives in the Keychain: it lasts about a year, so the code step happens once per iPhone.
struct PajSessionStore: Sendable {
    var keychain = Keychain(service: "cash.fliq.paj")

    func load() -> Paj.Session? {
        guard let saved = keychain.load(Paj.Session.self, for: "session"), saved.isValid() else { return nil }
        return saved
    }

    func save(_ session: Paj.Session) {
        try? keychain.save(session, for: "session")
    }

    /// The email or phone last confirmed with Paj, kept after the session expires so signing in again is one tap.
    func lastContact() -> String? {
        keychain.load(Paj.Session.self, for: "session")?.contact
    }
}

enum PajMessage {
    /// Paj and the web route both answer `{"message": ...}`, sometimes as a list.
    static func from(_ data: Data) -> String {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return "Paj didn't answer. Try again." }
        if let list = json["message"] as? [String], let first = list.first { return first }
        if let text = json["message"] as? String { return text }
        if json["error"] as? String == "sign_in_required" { return "Sign in to fliq again first." }
        if json["error"] as? String == "paj_not_configured" { return "Bank deposits aren't switched on yet." }
        return "Paj didn't answer. Try again."
    }
}


/// The demo build: a fixed rate and an order that pays itself after "I've sent the money".
actor FixturePaj: PajAPI, PajSignIn {
    private var polls = 0

    func publicRate() async throws -> Double { 1397.72 }

    func quote(naira: Int, session: Paj.Session) async throws -> Paj.Quote {
        Paj.Quote(naira: naira, usdc: (Double(naira) / 1397.04).rounded(toPlaces: 6), rate: 1397.72)
    }

    func createOrder(naira: Int, recipient: String, session: Paj.Session) async throws -> Paj.Order {
        polls = 0
        return Self.demoOrder(naira: naira, status: .initiated)
    }

    func order(_ id: String, session: Paj.Session) async throws -> Paj.Order {
        polls += 1
        return Self.demoOrder(naira: 5000, status: polls < 2 ? .paid : .completed)
    }

    private static func demoOrder(naira: Int, status: Paj.Order.Status) -> Paj.Order {
        Paj.Order(
            id: "demo-order", naira: naira, usdc: (Double(naira) / 1397.04).rounded(toPlaces: 6), rate: 1397.72,
            accountNumber: "0000000000", accountName: "Demo account", bank: "Demo bank", status: status
        )
    }

    func sendCode(to contact: String) async throws {}

    func verify(_ contact: String, code: String) async throws -> Paj.Session {
        Paj.Session(token: "demo", expiresAt: .now.addingTimeInterval(86_400), contact: contact)
    }
}

private extension Double {
    func rounded(toPlaces places: Int) -> Double {
        let scale = pow(10, Double(places))
        return (self * scale).rounded() / scale
    }
}
