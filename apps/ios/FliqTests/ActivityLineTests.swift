import XCTest
@testable import Fliq

final class ActivityLineTests: XCTestCase {
    private func line(kind: String = "deposit", status: String) throws -> ActivityLine {
        let json = """
        {
          "activity_id": "act_made_up", "kind": "\(kind)", "status": "\(status)", "at": "2026-11-14T10:00:00.000Z",
          "party": { "name": "Received from Solana", "near_account": null, "institution": null, "account_last4": null, "photo_url": null },
          "provider": null, "agent": null, "local": null, "usd": "0.58", "token": "0.59 USDC", "seconds": null,
          "reason": null, "ref_id": "dep_made_up"
        }
        """
        let item = try FliqJSON.decoder().decode(ActivityItem.self, from: Data(json.utf8))
        return ActivityLine(.history(item), institutions: [:])
    }

    func testARefundedDepositReadsAsNotReceivedAndStopsSpinning() throws {
        let line = try line(status: "refunded")

        XCTAssertEqual(line.statusText, "Not received")
        XCTAssertNotEqual(line.outcome, .moving, "The ring only turns for a row that is moving")
        XCTAssertNotEqual(line.outcome, .refunded, "Refunded would say the money is back in the vault")
        XCTAssertEqual(line.amount, "0.59 USDC", "What was sent, not a credit")
        XCTAssertNil(line.dollars)
        XCTAssertEqual(line.steps.last?.title, "Not received")
        XCTAssertEqual(line.steps.last?.detail, "Contact us and we'll sort it out.")
        XCTAssertFalse(line.facts.contains { $0.0 == "Delivered" })
    }

    func testAFailedOrExpiredDepositReadsAsNotReceived() throws {
        XCTAssertEqual(try line(status: "failed").statusText, "Not received")
        let expired = try line(status: "expired")
        XCTAssertEqual(expired.statusText, "Not received")
        XCTAssertEqual(expired.steps.map(\.title), ["Not received"], "Nothing was seen, so nothing is called sent")
    }

    func testADepositStillOnItsWayIsArriving() throws {
        let line = try line(status: "pending")
        XCTAssertEqual(line.statusText, "Arriving")
        XCTAssertEqual(line.outcome, .moving)
        XCTAssertEqual(line.amount, "+$0.58")
    }

    func testADepositThatLandedIsReceived() throws {
        XCTAssertEqual(try line(status: "received").statusText, "Received")
    }

    func testARefundedCashOutStillSaysRefunded() throws {
        let line = try line(kind: "payout", status: "refunded")
        XCTAssertEqual(line.statusText, "Refunded")
        XCTAssertEqual(line.outcome, .refunded)
    }
}
