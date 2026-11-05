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
            "Session": decode(Session.self),
            "User": decode(User.self),
            "NameAvailability": decode(NameAvailability.self),
            "WorkspaceCreated": decode(WorkspaceCreated.self),
            "PasskeyOptions": decode(PasskeyOptions.self),
            "EmailLinkSent": decode(EmailLinkSent.self),
            "Workspace": decode(Workspace.self),
            "KeyList": decode(KeyList.self),
            "Onboarding": decode(OnboardingChecklist.self),
            "PayoutList": decode(PayoutList.self),
            "PayoutStats": decode(PayoutStats.self),
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
        XCTAssertEqual(Money.dollars(TokenAmount(baseUnits: 128_180_000)), "128.18")
        XCTAssertEqual(Money.dollars(.zero), "0")
    }

    func testTokenAmountIsExactOnTheWire() throws {
        let quote: Quote = try fixtures.load("quote.usdc-ngn-50")

        XCTAssertEqual(quote.amount.baseUnits, 50_000_000)
        XCTAssertEqual(TokenAmount(decimalString: "12.345678")?.decimalString, "12.345678")
        XCTAssertEqual(TokenAmount(decimalString: "50")?.decimalString, "50.00")
        let encoded = try FliqJSON.encoder().encode(QuoteRequest(token: .usdc, currency: .ngn, amount: quote.amount))
        XCTAssertTrue(String(decoding: encoded, as: UTF8.self).contains(#""amount":"50.00""#))
    }

    func testTokenAmountRejectsBadInput() {
        for bad in ["", "-1", "1.2345678", "1.2.3", "abc", "١٢"] {
            XCTAssertNil(TokenAmount(decimalString: bad), bad)
        }
    }
}

final class NewEndpointFixtureTests: XCTestCase {
    private let fixtures = FixtureClient()

    func testPayoutListMatchesTheSettledPayout() throws {
        let list: PayoutList = try fixtures.load("payouts.list")
        let row = try XCTUnwrap(list.items.first)

        XCTAssertEqual(row.state, .settled)
        XCTAssertEqual(row.receive, 68816)
        XCTAssertEqual(row.amount.decimalString, "50.00")
        XCTAssertEqual(row.bank.name, "GTBank")
        XCTAssertNil(list.nextCursor)
    }

    func testSignedInSessionCarriesTheClaimedName() throws {
        let session: Session = try fixtures.load("session.signed-in")
        XCTAssertEqual(session.user.nearAccount, "frank.fliq.near")
        let newUser: User = try fixtures.load("user.new")
        XCTAssertNil(newUser.nearAccount, "A new user has no fliq name until onboarding claims one")
    }
}
