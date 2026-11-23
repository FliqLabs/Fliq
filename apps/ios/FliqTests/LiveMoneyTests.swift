import XCTest
@testable import Fliq

/// The Live Activity steps must match what the API pushes, or the pill would jump back and forth.
final class LiveMoneyTests: XCTestCase {
    private func status(_ stage: DepositStatus.Stage, seen: Bool = false, bridging: Bool = false) -> DepositStatus {
        DepositStatus(stage: stage, received: nil, seenAt: seen ? .now : nil, bridgingAt: bridging ? .now : nil, landedAt: nil)
    }

    func testADepositMovesThroughThreeStepsAndEndsInTheVault() {
        XCTAssertEqual(LiveMoney.deposit(status(.waiting), chain: "solana").step, 0)
        XCTAssertEqual(LiveMoney.deposit(status(.seen), chain: "solana").status, "Seen on Solana")
        XCTAssertEqual(LiveMoney.deposit(status(.seen), chain: "bnb").status, "Seen on BNB Chain")
        XCTAssertEqual(LiveMoney.deposit(status(.bridging), chain: "near").step, 2)
        let landed = LiveMoney.deposit(status(.landed), chain: "solana")
        XCTAssertEqual(landed, .init(step: 3, steps: 3, status: "In your vault", done: true, failed: false))
    }

    func testADepositThatFailsKeepsTheStepItReached() {
        let refunded = LiveMoney.deposit(status(.refunded, seen: true, bridging: true), chain: "solana")
        XCTAssertEqual(refunded, .init(step: 2, steps: 3, status: "Refunded", done: false, failed: true))
        XCTAssertEqual(LiveMoney.deposit(status(.underpaid), chain: "solana").step, 1)
        XCTAssertEqual(LiveMoney.deposit(status(.expired), chain: "solana").status, "Nothing arrived")
    }

    func testACashOutMovesThroughThreeStepsAndEndsPaid() {
        XCTAssertEqual(LiveMoney.payout(.awaitingDeposit).status, "Sending")
        XCTAssertEqual(LiveMoney.payout(.routing).step, 1)
        XCTAssertEqual(LiveMoney.payout(.payingOut).status, "The bank is paying")
        XCTAssertEqual(LiveMoney.payout(.settled), .init(step: 3, steps: 3, status: "Paid out", done: true, failed: false))
        XCTAssertTrue(LiveMoney.payout(.refunded).failed)
        XCTAssertEqual(LiveMoney.payout(.notReceived).status, "Not paid")
    }

    func testABankDepositNeverNamesThePartnerOrTheChain() {
        let steps: [Paj.Order.Status] = [.initiated, .paid, .completed]
        XCTAssertEqual(steps.compactMap { LiveMoney.bankDeposit($0)?.status }, ["Waiting for your transfer", "Your bank sent it", "Moving to your vault"])
        XCTAssertEqual(LiveMoney.bankDeposit(.completed)?.step, 2, "The API takes over at the same step")
        XCTAssertNil(LiveMoney.bankDeposit(.failed))
        XCTAssertEqual(LiveMoney.bankDepositLanded(true).status, "In your vault")
        XCTAssertTrue(LiveMoney.bankDepositLanded(false).failed)
        for state in steps.compactMap({ LiveMoney.bankDeposit($0) }) {
            XCTAssertFalse(state.status.contains("Paj"))
            XCTAssertFalse(state.status.contains("Solana"))
        }
    }

    func testASendToAWalletMatchesWhatTheAPIPushes() {
        XCTAssertEqual(LiveMoney.send(.awaiting, chain: "tron"), .init(step: 1, steps: 3, status: "Sending", done: false, failed: false))
        XCTAssertEqual(LiveMoney.send(.moving, chain: "tron").status, "On its way to Tron")
        XCTAssertEqual(LiveMoney.send(.delivered, chain: "solana"), .init(step: 3, steps: 3, status: "Delivered", done: true, failed: false))
        XCTAssertEqual(LiveMoney.send(.expired, chain: "base").status, "Not sent")
    }

    func testThePushedStateDecodesByTheKeysTheAPISends() throws {
        let json = #"{"step":2,"steps":3,"status":"The bank is paying","done":false,"failed":false}"#
        let state = try JSONDecoder().decode(MoneyActivityAttributes.ContentState.self, from: Data(json.utf8))
        XCTAssertEqual(state, LiveMoney.payout(.payingOut))
    }

    func testTheBankLineShowsOnlyTheLastFourDigits() {
        XCTAssertEqual(LiveMoney.bankLine(institution: "Moniepoint", number: "8123455320"), "Moniepoint ••5320")
    }
}
