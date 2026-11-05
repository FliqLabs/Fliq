import XCTest
@testable import Fliq

@MainActor
final class ReceiveTests: XCTestCase {
    private func makeFlow(vault: VaultStore = VaultStore()) async -> ReceiveFlow {
        let flow = ReceiveFlow(api: FixtureDepositAPI(), vault: vault, vaultAccount: "frank.fliq.near")
        await flow.loadSources()
        return flow
    }

    func testAnAddressComesWithoutAskingForAnAmount() async throws {
        let vault = VaultStore()
        let flow = await makeFlow(vault: vault)
        flow.source = flow.sources.first { $0.chain == "Solana" }

        let reserved = await flow.reserve()
        XCTAssertTrue(reserved)
        let deposit = try XCTUnwrap(flow.deposit)
        XCTAssertTrue(deposit.isDemo, "Fixture addresses must say they are demo")
        XCTAssertEqual(Money.dollars(deposit.minimum), "1")
        XCTAssertNil(flow.landing, "Nothing is promised before the deposit is seen")

        await flow.track()
        XCTAssertEqual(flow.status?.stage, .landed)
        XCTAssertEqual(flow.landing?.decimalString, "199.98", "200 USDC seen, less the $0.02 fee")
        XCTAssertEqual(vault.balance.decimalString, "199.98")

        await flow.track()
        XCTAssertEqual(vault.balance.decimalString, "199.98", "A landed deposit is credited once")
    }

    func testTronKeepsItsMinimum() async throws {
        let flow = await makeFlow()
        flow.source = flow.sources.first { $0.chain == "Tron" }
        _ = await flow.reserve()
        XCTAssertEqual(Money.dollars(try XCTUnwrap(flow.deposit).minimum), "100")
    }

    func testNearDepositsGoStraightToTheVaultWithNoFee() async throws {
        let flow = await makeFlow()
        flow.source = flow.sources.first { $0.isDirect }
        _ = await flow.reserve()
        let deposit = try XCTUnwrap(flow.deposit)

        XCTAssertEqual(deposit.address, "frank.fliq.near")
        XCTAssertEqual(deposit.fee, .zero)
    }

    func testAnAddressExpiresAfterItsWindow() async throws {
        let flow = await makeFlow()
        flow.source = flow.sources.first { $0.chain == "Base" }
        _ = await flow.reserve()
        let deposit = try XCTUnwrap(flow.deposit)

        XCTAssertGreaterThan(flow.secondsLeft(at: .now), 590)
        XCTAssertEqual(flow.secondsLeft(at: deposit.reservedUntil.addingTimeInterval(1)), 0)
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
