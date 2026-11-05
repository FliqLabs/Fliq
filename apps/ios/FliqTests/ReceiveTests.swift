import XCTest
@testable import Fliq

@MainActor
final class ReceiveTests: XCTestCase {
    private func makeFlow(vault: VaultStore = VaultStore()) async -> ReceiveFlow {
        let flow = ReceiveFlow(api: FixtureDepositAPI(), vault: vault, vaultAccount: "frank.fliq.near")
        await flow.loadSources()
        return flow
    }

    func testTopUpLandsOnceAndCreditsTheVault() async throws {
        let vault = VaultStore()
        let flow = await makeFlow(vault: vault)
        flow.source = flow.sources.first { $0.chain == "Solana" }
        "200".forEach { flow.tapKey(String($0)) }

        XCTAssertEqual(flow.estimatedLanding?.decimalString, "199.98")
        let reserved = await flow.reserve()
        XCTAssertTrue(reserved)
        let deposit = try XCTUnwrap(flow.deposit)
        XCTAssertTrue(deposit.isDemo, "Fixture addresses must say they are demo")

        await flow.track()
        XCTAssertEqual(flow.status?.stage, .landed)
        XCTAssertEqual(vault.balance.decimalString, "199.98")

        await flow.track()
        XCTAssertEqual(vault.balance.decimalString, "199.98", "A landed deposit is credited once")
    }

    func testTronMinimum() async {
        let flow = await makeFlow()
        flow.source = flow.sources.first { $0.chain == "Tron" }
        "50".forEach { flow.tapKey(String($0)) }
        XCTAssertTrue(flow.belowMinimum)
        XCTAssertFalse(flow.canReserve)

        flow.tapKey("0")
        XCTAssertFalse(flow.belowMinimum)
        XCTAssertTrue(flow.canReserve)
    }

    func testNearDepositsGoStraightToTheVaultWithNoFee() async throws {
        let flow = await makeFlow()
        flow.source = flow.sources.first { $0.isDirect }
        _ = await flow.reserve()
        let deposit = try XCTUnwrap(flow.deposit)

        XCTAssertEqual(deposit.address, "frank.fliq.near")
        XCTAssertEqual(deposit.fee, .zero)
    }

    func testPayingDebitsAndARefundCreditsBack() async {
        let vault = VaultStore(balance: TokenAmount(baseUnits: 199_980_000))
        let flow = PayFlow(api: FixtureClient(), vault: vault)
        "13".forEach { flow.tapKey(String($0)) }
        _ = await flow.fetchQuote()
        flow.recipient.number = "0123456789"
        await flow.recipient.verify()
        _ = await flow.send()
        XCTAssertEqual(vault.balance.decimalString, "149.98", "The fixture quote is $50")

        await flow.track()
        XCTAssertEqual(flow.payout?.state, .refunded)
        XCTAssertEqual(vault.balance.decimalString, "199.98")
    }

    func testAmountTypingRules() {
        var text = ""
        for key in ["0", "0", ".", "5", "5", "5", "⌫"] { text = AmountTyping.apply(key, to: text) }
        XCTAssertEqual(text, "0.5")
    }
}
