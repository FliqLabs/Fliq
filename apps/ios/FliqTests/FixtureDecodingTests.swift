import XCTest
@testable import Fliq

/// Decodes every file in spec/fixtures into the type spec/fixtures/index.json names for it,
/// so a spec change that breaks the app fails here first.
final class FixtureDecodingTests: XCTestCase {
    private let fixtures = FixtureClient()

    private let decoders: [String: (Data) throws -> Any] = {
        func decode<T: Decodable>(_: T.Type) -> (Data) throws -> Any {
            { try FliqJSON.decoder().decode(T.self, from: $0) }
        }
        return [
            "Health": decode(Health.self),
            "Rate": decode(Rate.self),
            "Quote": decode(Quote.self),
            "VerifiedAccount": decode(VerifiedAccount.self),
            "Payout": decode(Payout.self),
            "Refusal": decode(Refusal.self),
            "Error": decode(ErrorBody.self),
        ]
    }()

    func testEveryFixtureDecodes() throws {
        let index = try JSONDecoder().decode([String: String].self, from: fixtures.data("index"))
        XCTAssertFalse(index.isEmpty)

        for (file, typeName) in index {
            let decode = try XCTUnwrap(decoders[typeName], "No Swift type mapped for \(typeName)")
            let name = String(file.dropLast(".json".count))
            XCTAssertNoThrow(try decode(fixtures.data(name)), "\(file) does not decode as \(typeName)")
        }
    }

    func testSettledPayoutWalksEveryHappyState() throws {
        let payout: Payout = try fixtures.load("payout.settled")

        XCTAssertEqual(payout.history.map(\.state), [.awaitingDeposit, .depositSeen, .payingOut, .settled])
        XCTAssertTrue(payout.state.isFinal)
        XCTAssertNotNil(payout.bankReference)
    }

    func testMoneyFormatting() throws {
        let rate: Rate = try fixtures.load("rate.usdc-ngn")

        XCTAssertEqual(Money.rate(rate.rate, rate.currency), "₦1,376.32")
        XCTAssertEqual(Money.local(68816, .ngn), "₦68,816")
    }
}
