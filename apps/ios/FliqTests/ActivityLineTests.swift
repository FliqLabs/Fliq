import XCTest
@testable import Fliq

final class ActivityLineTests: XCTestCase {
    private func line(kind: String = "deposit", status: String, reason: String? = nil, party: String = "Received from Solana") throws -> ActivityLine {
        let json = """
        {
          "activity_id": "act_made_up", "kind": "\(kind)", "status": "\(status)", "at": "2026-11-14T10:00:00.000Z",
          "party": { "name": "\(party)", "near_account": null, "institution": null, "account_last4": null, "photo_url": null },
          "provider": null, "agent": null, "local": null, "usd": "0.58", "token": "0.59 USDC", "seconds": null,
          "reason": \(reason.map { "\"\($0)\"" } ?? "null"), "ref_id": "dep_made_up"
        }
        """
        let item = try FliqJSON.decoder().decode(ActivityItem.self, from: Data(json.utf8))
        return ActivityLine(.history(item), institutions: [:])
    }

    /// A refunded deposit is in the user's NEAR Intents balance, and Home offers to bring it back, so it says so.
    func testARefundedDepositSaysTheMoneyIsSafeAndStopsSpinning() throws {
        let line = try line(status: "refunded")

        XCTAssertEqual(line.statusText, "Not received")
        XCTAssertNotEqual(line.outcome, .moving, "The ring only turns for a row that is moving")
        XCTAssertNotEqual(line.outcome, .refunded, "Refunded would say the money is back in the vault")
        XCTAssertEqual(line.amount, "0.59 USDC", "What was sent, not a credit")
        XCTAssertNil(line.dollars)
        XCTAssertEqual(line.steps.last?.title, "Sent back to you")
        XCTAssertEqual(line.steps.last?.detail, "Your money is safe. Add it back to your vault from Home.")
        XCTAssertTrue(line.facts.contains { $0 == ("Status", "Refunded to you") })
        XCTAssertFalse(line.facts.contains { $0.0 == "Delivered" })
    }

    func testAFailedOrExpiredDepositReadsAsNotReceived() throws {
        XCTAssertEqual(try line(status: "failed").statusText, "Not received")
        let expired = try line(status: "expired")
        XCTAssertEqual(expired.statusText, "Not received")
        XCTAssertEqual(expired.steps.map(\.title), ["Not received"], "Nothing was seen, so nothing is called sent")
    }

    func testABankDepositThePartnerStoppedSaysTheMoneyIsSafe() throws {
        let line = try line(status: "failed", reason: "bank_stopped", party: ActivityItem.bankPartyName)
        XCTAssertEqual(line.steps.map(\.title), ["Paid from your bank", "Stopped before your vault"])
        XCTAssertTrue(line.steps.last?.detail.contains("If you sent money, it's safe") == true)
        XCTAssertTrue(line.facts.contains { $0 == ("Status", "Stopped") })
        XCTAssertNotEqual(line.outcome, .moving)
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
        XCTAssertTrue(line.subtitle.hasSuffix("Not paid, refunded to you"), "Says what happened to the money, not which provider failed")
        XCTAssertEqual(line.steps.last?.title, "Back in your vault")
    }

    func testABankDepositShowsTheNigerianFlagNotAnArrow() {
        let deposit = ActivityStore.BankDeposit(depositId: "dep_flag", naira: 10_000, usd: "6.96", startedAt: .now)
        let line = ActivityLine(.history(.bankDeposit(deposit, status: "pending")), institutions: [:])
        guard case .nigerianBank = line.badge else { return XCTFail("Expected the Nigerian flag, got \(line.badge)") }
    }
}
