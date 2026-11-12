import XCTest
@testable import Fliq

@MainActor
final class ReceiveTests: XCTestCase {
    private func makeFlow(vault: VaultStore = VaultStore()) async -> ReceiveFlow {
        let flow = ReceiveFlow(api: FixtureDepositAPI(), vault: vault, vaultAccount: "frank.fliq.near")
        flow.pollInterval = .zero
        await flow.loadSources()
        return flow
    }

    func testAnAddressComesWithoutAskingForAnAmount() async throws {
        let vault = VaultStore()
        let flow = await makeFlow(vault: vault)
        let reserved = await flow.reserve(try XCTUnwrap(flow.sources.first { $0.chain == "Solana" }))
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
        _ = await flow.reserve(try XCTUnwrap(flow.sources.first { $0.chain == "Tron" }))
        XCTAssertEqual(Money.dollars(try XCTUnwrap(flow.deposit).minimum), "100")
    }

    func testNearDepositsGoStraightToTheVaultWithNoFee() async throws {
        let flow = await makeFlow()
        _ = await flow.reserve(try XCTUnwrap(flow.sources.first { $0.isDirect }))
        let deposit = try XCTUnwrap(flow.deposit)

        XCTAssertEqual(deposit.address, "frank.fliq.near")
        XCTAssertEqual(deposit.fee, .zero)
    }

    func testAnAddressExpiresAfterItsWindow() async throws {
        let flow = await makeFlow()
        _ = await flow.reserve(try XCTUnwrap(flow.sources.first { $0.chain == "Base" }))
        let deposit = try XCTUnwrap(flow.deposit)

        XCTAssertGreaterThan(flow.secondsLeft(at: .now), 590)
        XCTAssertEqual(flow.secondsLeft(at: deposit.reservedUntil.addingTimeInterval(1)), 0)
    }

    func testCurrenciesListEachCoinOnceWithNEARUnderDollars() async {
        let flow = await makeFlow()

        XCTAssertEqual(flow.currencies.map(\.group), [.dollars, .bitcoin])
        XCTAssertEqual(flow.currencies.first?.tokens, ["usdc", "usdt"])
        XCTAssertEqual(flow.networks(for: "usdc").first?.chainId, "near", "Your own NEAR address comes first: instant, no fee")
        XCTAssertEqual(flow.networks(for: "usdc").count, 6)
    }

    func testASourceTheServerRefusesIsMarkedAndNotOpened() async throws {
        let flow = ReceiveFlow(api: Refusing(), vault: VaultStore(), vaultAccount: "frank.fliq.near")
        await flow.loadSources()
        let base = try XCTUnwrap(flow.sources.first { $0.chainId == "base" })

        let reserved = await flow.reserve(base)

        XCTAssertFalse(reserved)
        XCTAssertNil(flow.deposit)
        XCTAssertEqual(flow.reason(unavailable: base), "Receiving from base is not available right now.")
    }

    func testTestnetOffersOnlyTheUsersOwnNEARAccount() async {
        let flow = ReceiveFlow(api: FixtureDepositAPI(), vault: VaultStore(), vaultAccount: "frank.fliq.near", network: .testnet)
        await flow.loadSources()

        XCTAssertEqual(flow.offered.map(\.chainId), ["near"])
        XCTAssertEqual(flow.currencies.map(\.group), [.dollars], "Bitcoin has no source on testnet, so it is hidden")
        XCTAssertEqual(flow.currencies.first?.tokens, ["usdc"], "USDT has no source on testnet, so it is hidden")
        XCTAssertEqual(flow.onlyOption?.chainId, "near", "One way to receive skips both pickers")
    }

    func testMainnetOffersEveryAvailableChain() async {
        let flow = await makeFlow()

        XCTAssertEqual(flow.offered.count, 8)
        XCTAssertNil(flow.onlyOption)
    }

    func testASourceTheAPIMarksUnavailableShowsAsComingSoon() async throws {
        let flow = ReceiveFlow(api: PartlyAvailable(), vault: VaultStore(), vaultAccount: "frank.fliq.near")
        await flow.loadSources()

        XCTAssertFalse(flow.networks(for: "usdc").contains { $0.chainId == "base" }, "It can't be picked")
        let base = try XCTUnwrap(flow.choices(for: "usdc").last)
        XCTAssertEqual(base.chainId, "base", "It is listed after the working networks")
        XCTAssertEqual(flow.reason(unavailable: base), "Coming soon")
        XCTAssertTrue(flow.currencies.contains { $0.group == .bitcoin }, "A currency with no working source stays, as coming soon")
        XCTAssertTrue(flow.networks(for: "btc").isEmpty)
    }

    func testASourceRefusedWhenReservingDropsOutWithANote() async throws {
        let flow = ReceiveFlow(api: Refusing(), vault: VaultStore(), vaultAccount: "frank.fliq.near")
        await flow.loadSources()
        let base = try XCTUnwrap(flow.sources.first { $0.chainId == "base" })

        _ = await flow.reserve(base)

        XCTAssertFalse(flow.networks(for: "usdc").contains(base))
        XCTAssertEqual(flow.notice, "USDC on Base isn't available right now.")
    }

    func testTheNetworkComesFromTheBuildSettingOrTheRPC() {
        XCTAssertEqual(NearNetwork.from(["FliqNearNetwork": "mainnet", "FliqNearRPCURL": "https://rpc.testnet.near.org"]), .mainnet)
        XCTAssertEqual(NearNetwork.from(["FliqNearRPCURL": "https://rpc.testnet.near.org"]), .testnet)
        XCTAssertEqual(NearNetwork.from(["FliqNearRPCURL": "https://rpc.mainnet.near.org"]), .mainnet)
    }

    func testTheAPIsDepositsReadIntoAddressesAndStages() throws {
        let decoder = FliqJSON.decoder()
        let waiting = try decoder.decode(HTTPDepositAPI.VaultDeposit.self, from: try fixture("deposit.waiting"))
        let landed = try decoder.decode(HTTPDepositAPI.VaultDeposit.self, from: try fixture("deposit.landed"))
        let solana = DepositSource(tokenId: "usdc", chainId: "solana", group: .dollars)

        let address = HTTPDepositAPI.address(waiting, source: solana)
        XCTAssertEqual(address.depositId, "dep_01jbd2m5k8w3qf7v9x2c4n6h8t")
        XCTAssertEqual(address.minimum, TokenAmount(baseUnits: 196_000_000))
        XCTAssertEqual(address.fee.decimalString, "0.02")
        XCTAssertEqual(HTTPDepositAPI.status(waiting).stage, .waiting)
        XCTAssertEqual(HTTPDepositAPI.status(landed).stage, .landed)
        XCTAssertNotNil(HTTPDepositAPI.status(landed).landed)
    }

    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(Bundle.main.url(forResource: name, withExtension: "json", subdirectory: "fixtures"))
        return try Data(contentsOf: url)
    }

    private struct Refusing: DepositAPI {
        func sources() async throws -> [DepositSource] { try await FixtureDepositAPI().sources() }
        func reserve(_ source: DepositSource, vault: String) async throws -> DepositAddress {
            throw DepositUnavailable(message: "Receiving from \(source.chainId) is not available right now.")
        }
        func status(of deposit: DepositAddress) async throws -> DepositStatus { throw DepositUnavailable(message: "") }
    }

    private struct PartlyAvailable: DepositAPI {
        func sources() async throws -> [DepositSource] {
            try await FixtureDepositAPI().sources().map { source in
                var source = source
                source.available = !["base", "bitcoin"].contains(source.chainId)
                return source
            }
        }
        func reserve(_ source: DepositSource, vault: String) async throws -> DepositAddress {
            try await FixtureDepositAPI().reserve(source, vault: vault)
        }
        func status(of deposit: DepositAddress) async throws -> DepositStatus { throw DepositUnavailable(message: "") }
    }

    func testPayingDebitsAndARefundCreditsBack() async {
        let vault = VaultStore(balance: TokenAmount(baseUnits: 199_980_000))
        let flow = PayFlow(api: FixtureClient(), vault: vault)
        flow.enterAmount("13")
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
        for key in ["0", "0", ".", "5", "5", "5"] { text = AmountTyping.clean(text + key, previous: text) }
        text = AmountTyping.clean(String(text.dropLast()), previous: text)
        XCTAssertEqual(text, "0.5", "Typed one key at a time, then one backspace")
    }
}
