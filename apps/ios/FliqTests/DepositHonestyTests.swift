import XCTest
@testable import Fliq

/// A tester's card said $2.06 while $1.95 reached the vault, and a "jup::err" reached the screen (17 Nov).
final class DepositHonestyTests: XCTestCase {
    func testTheCardEndsOnWhatLandedNotTheEstimate() {
        let landed = LiveMoney.bankDepositLanded(true, landed: TokenAmount(baseUnits: 1_954_000))
        XCTAssertEqual(landed.amount, "$1.95")
        XCTAssertNil(LiveMoney.bankDepositLanded(false).amount)
    }

    func testThePushedLastStepCarriesTheLandedAmount() throws {
        let json = #"{"step":3,"steps":3,"status":"In your vault","done":true,"failed":false,"amount":"$1.95"}"#
        let state = try JSONDecoder().decode(MoneyActivityAttributes.ContentState.self, from: Data(json.utf8))
        XCTAssertEqual(state.amount, "$1.95")
        let older = #"{"step":2,"steps":3,"status":"Moving to your vault","done":false,"failed":false}"#
        XCTAssertNil(try JSONDecoder().decode(MoneyActivityAttributes.ContentState.self, from: Data(older.utf8)).amount)
    }

    func testThePartnersSwapErrorsAreRetriedAndNeverShownRaw() {
        XCTAssertTrue(PajMessage.isTemporary("jup::err: route not found"))
        XCTAssertTrue(PajMessage.isTemporary("Internal server error"))
        XCTAssertFalse(PajMessage.isTemporary("Invalid OTP"))
        XCTAssertFalse(PajMessage.busy.lowercased().contains("jup"))
    }
}
