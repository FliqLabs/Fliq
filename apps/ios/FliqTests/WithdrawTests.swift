import CryptoKit
import XCTest
@testable import Fliq

final class WithdrawDelegateTests: XCTestCase {
    func testTheOnwardSendFitsTheRelayerRules() {
        let action = DelegateAction.usdcTransfer(
            from: "olien.fliqaccount.near", to: "rejois.near", units: 300_000, usdc: "usdc.near",
            nonce: 10, blockHeight: 100, publicKey: Data(repeating: 1, count: 32)
        )
        XCTAssertEqual(action.receiverId, "usdc.near")
        XCTAssertEqual(action.call.methodName, "ft_transfer")
        XCTAssertEqual(String(decoding: action.call.args, as: UTF8.self), #"{"receiver_id":"rejois.near","amount":"300000","memo":"fliq"}"#)
        XCTAssertEqual(action.call.deposit, 1)
    }

    func testANewWalletIsRegisteredOnlyForUSDC() throws {
        let cost = try XCTUnwrap(Yocto(decimal: "1250000000000000000000"))
        let action = DelegateAction.usdcRegistration(
            from: "olien.fliqaccount.near", for: "rejois.near", cost: cost, usdc: "usdc.near",
            nonce: 10, blockHeight: 100, publicKey: Data(repeating: 1, count: 32)
        )
        XCTAssertEqual(action.call.methodName, "storage_deposit")
        XCTAssertEqual(String(decoding: action.call.args, as: UTF8.self), #"{"account_id":"rejois.near","registration_only":true}"#)
        XCTAssertEqual(action.call.deposit, cost)
    }

    func testBase58DecodesABlockHashWithLeadingZeros() {
        XCTAssertEqual(NEARKey.base58Decode("11111111111111111111111111111111"), Data(repeating: 0, count: 32))
        XCTAssertNil(NEARKey.base58Decode("0OIl"))
    }

    func testTheVaultWithdrawFitsTheRelayerRules() throws {
        let action = DelegateAction.vaultWithdraw(
            from: "olien.fliqaccount.testnet", units: 2_000_000, vault: "fliq-vault.testnet",
            nonce: 9, blockHeight: 100, publicKey: Data(repeating: 1, count: 32)
        )
        XCTAssertEqual(String(decoding: action.call.args, as: UTF8.self), #"{"amount":"2000000"}"#)
        XCTAssertEqual(action.call.deposit, 1)
        XCTAssertGreaterThanOrEqual(action.call.gas, 60_000_000_000_000)
        XCTAssertLessThanOrEqual(action.call.gas, 100_000_000_000_000)
    }
}

final class WithdrawAddressTests: XCTestCase {
    func testOnlyNEARWalletsOutsideFliqAreAccepted() {
        let contracts = ["fliq-vault.testnet", "usdc.testnet"]
        XCTAssertNil(WithdrawAddress.problem("bob.testnet", own: "me.testnet", contracts: contracts))
        XCTAssertNil(WithdrawAddress.problem(String(repeating: "ab", count: 32), own: nil, contracts: contracts))
        XCTAssertNotNil(WithdrawAddress.problem("0xc419527d40812245553de6ab199e1390c29ceb4f", own: nil, contracts: contracts))
        XCTAssertNotNil(WithdrawAddress.problem("Bob!", own: nil, contracts: contracts))
        XCTAssertNotNil(WithdrawAddress.problem("me.testnet", own: "me.testnet", contracts: contracts))
        XCTAssertNotNil(WithdrawAddress.problem("fliq-vault.testnet", own: nil, contracts: contracts))
    }

    func testPastedAddressesAreTrimmedAndLowercased() {
        XCTAssertEqual(WithdrawAddress.normalized("  Bob.Testnet\n"), "bob.testnet")
    }

    func testYoctoBecomesAnExactDecimal() {
        XCTAssertEqual(Yocto(decimal: "1250000000000000000000")?.decimal, Decimal(string: "1250000000000000000000"))
    }
}

final class RecipientCurrencyTests: XCTestCase {
    func testOnlyUSDCToANEARWalletIsOfferedAsAStablecoin() {
        XCTAssertEqual(PayoutCurrency.stablecoins.map(\.code), ["USDC"])
        XCTAssertTrue(PayoutCurrency.stablecoins.allSatisfy { $0.isLive && $0.toNearWallet })
        XCTAssertTrue(PayoutCurrency.live.allSatisfy(\.isLive))
        XCTAssertFalse(PayoutCurrency.soon.contains(where: \.isLive))
    }
}

@MainActor
final class WithdrawFlowTests: XCTestCase {
    private struct Undelivered: Withdrawals {
        func check(_ address: String) async -> AddressCheck { .ready(needsSetup: true) }
        func prepare(_ amount: TokenAmount, to address: String) async throws -> PreparedWithdraw {
            PreparedWithdraw(amount: amount, address: address, actions: [])
        }

        func sign(_ prepared: PreparedWithdraw) throws -> SignedWithdraw { SignedWithdraw(actions: [], signatures: []) }

        func deliver(_ signed: SignedWithdraw) async throws -> WithdrawReceipt {
            throw WithdrawError.notDelivered("ft_transfer failed")
        }
    }

    private func vault() -> VaultStore { VaultStore(balance: TokenAmount(baseUnits: 20_000_000)) }

    private func recents() -> SentAddresses {
        let defaults = UserDefaults(suiteName: "withdraw-tests")!
        defaults.removePersistentDomain(forName: "withdraw-tests")
        return SentAddresses(defaults: defaults)
    }

    func testACheckedAddressAndAnAmountInTheVaultCanBeSent() async {
        let vault = vault()
        let flow = WithdrawFlow(withdrawals: FixtureWithdrawals(), vault: vault, recents: recents())
        flow.addressText = "bob.testnet"
        await flow.checkAddress()
        flow.enterAmount("25")
        XCTAssertFalse(flow.canSend, "More than the vault holds")

        flow.enterAmount("5")
        let sent = await flow.send()
        XCTAssertTrue(sent)
        XCTAssertEqual(flow.sent?.address, "bob.testnet")
        XCTAssertEqual(vault.balance, TokenAmount(baseUnits: 15_000_000))
    }

    func testEditingTheAddressDropsTheOldCheck() async {
        let flow = WithdrawFlow(withdrawals: FixtureWithdrawals(), vault: vault(), recents: recents())
        flow.addressText = "bob.testnet"
        await flow.checkAddress()
        XCTAssertEqual(flow.check, .ready(needsSetup: false))
        flow.addressText = "bob.testne"
        XCTAssertNil(flow.check)
    }

    func testASentAddressBecomesARecentWithItsCount() async {
        let store = recents()
        for _ in 0..<2 {
            let flow = WithdrawFlow(withdrawals: FixtureWithdrawals(), vault: vault(), recents: store)
            flow.pick("bob.testnet")
            await flow.checkAddress()
            flow.enterAmount("1")
            _ = await flow.send()
        }
        let flow = WithdrawFlow(withdrawals: FixtureWithdrawals(), vault: vault(), recents: store)
        XCTAssertEqual(flow.recentAddresses.map(\.address), ["bob.testnet"])
        XCTAssertEqual(flow.recentAddresses.first?.count, 2)
    }

    func testSendAllNeverRoundsAboveTheVault() {
        let flow = WithdrawFlow(withdrawals: FixtureWithdrawals(), vault: VaultStore(balance: TokenAmount(baseUnits: 1_587_999)), recents: recents())
        flow.useEverything()
        XCTAssertEqual(flow.amountText, "1.58")
        XCTAssertTrue(flow.hasAmount)
    }

    func testSendAllFillsTheVaultBalance() {
        let flow = WithdrawFlow(withdrawals: FixtureWithdrawals(), vault: vault(), recents: recents())
        flow.useEverything()
        XCTAssertEqual(flow.amount, TokenAmount(baseUnits: 20_000_000))
    }

    func testAnUndeliveredTransferSaysWhereTheMoneyWaits() async {
        let vault = vault()
        var refreshed = false
        let flow = WithdrawFlow(withdrawals: Undelivered(), vault: vault, recents: recents(), onLeftVault: { refreshed = true })
        flow.addressText = "bob.testnet"
        await flow.checkAddress()
        XCTAssertEqual(flow.check, .ready(needsSetup: true))
        flow.enterAmount("5")

        let sent = await flow.send()
        XCTAssertFalse(sent)
        XCTAssertEqual(vault.balance, TokenAmount(baseUnits: 15_000_000))
        XCTAssertTrue(refreshed)
        XCTAssertTrue(flow.errorMessage?.contains("fliq wallet") ?? false)
    }
}

private extension Data {
    init(hex: String) {
        var bytes: [UInt8] = []
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            bytes.append(UInt8(hex[index..<next], radix: 16) ?? 0)
            index = next
        }
        self.init(bytes)
    }
}

/// Sending to a wallet on another network: the same signed transfer, to the address NEAR Intents gives for the send.
@MainActor
final class SendToNetworkTests: XCTestCase {
    private let solanaWallet = "4Nd1mYQzvgV8Vr3Z3nYb7pD6T1K9wLx2aRkQeJcUuHsM"
    private let baseWallet = "0x00000000000000000000000000000000000000A1"

    private func recents() -> SentAddresses { SentAddresses(defaults: UserDefaults(suiteName: "send-network-tests-\(UUID().uuidString)")!) }

    private func makeFlow(balance: Int64 = 50_000_000) async -> WithdrawFlow {
        let flow = WithdrawFlow(withdrawals: FixtureWithdrawals(), sends: FixtureSendsAPI(), vault: VaultStore(balance: TokenAmount(baseUnits: balance)), recents: recents())
        flow.pollInterval = .zero
        await flow.loadNetworks()
        return flow
    }

    private func network(_ chain: String, in flow: WithdrawFlow) throws -> SendNetwork {
        try XCTUnwrap(flow.networks.first { $0.chain == chain })
    }

    func testNEARComesFirstThenTheNetworksTheAPIOffers() async {
        let flow = await makeFlow()
        XCTAssertEqual(flow.networks.map(\.chain), ["near", "solana", "base", "tron", "bnb"])
        XCTAssertEqual(flow.networks.map(\.tokenName), ["USDC", "USDC", "USDC", "USDT", "USDT"])
        XCTAssertTrue(flow.network.isNEAR)
    }

    func testAnAddressIsCheckedForTheNetworkPickedAndKeptExactlyAsTyped() async throws {
        let flow = await makeFlow()
        flow.network = try network("solana", in: flow)
        flow.addressText = "  \(solanaWallet) "
        await flow.checkAddress()
        XCTAssertTrue(flow.hasAddress)
        XCTAssertEqual(flow.address, solanaWallet, "Case matters on Solana, so nothing is lowered")

        flow.addressText = baseWallet
        await flow.checkAddress()
        XCTAssertFalse(flow.hasAddress)
        XCTAssertEqual(flow.check, .invalid("That's a Base or Ethereum address. Choose Base above to send it there."))

        flow.network = try network("base", in: flow)
        await flow.checkAddress()
        XCTAssertTrue(flow.hasAddress)
        XCTAssertEqual(SendAddress.problem("0x123", on: flow.network), "That isn't a Base address. It starts with 0x and has 42 characters.")
    }

    func testTronAddressesAreCheckedToTheLastCharacterAndBNBChainTakesA0xAddress() async throws {
        let tronWallet = "TA4Wt1DUCqz6YegbnsmqsWC5uUfbdBqPxm"
        let flow = await makeFlow()
        let tron = try network("tron", in: flow)
        XCTAssertNil(SendAddress.problem(tronWallet, on: tron))
        XCTAssertEqual(SendAddress.problem("TA4Wt1DUCqz6YegbnsmqsWC5uUfbdBqPxa", on: tron), "That Tron address has a typo. Copy it again.")
        XCTAssertEqual(SendAddress.problem(baseWallet, on: tron), "That's a Base or BNB Chain address. Choose one of those above to send it there.")
        XCTAssertEqual(SendAddress.problem(tronWallet, on: try network("solana", in: flow)), "That's a Tron address. Choose Tron above to send it there.")

        let bnb = try network("bnb", in: flow)
        XCTAssertNil(SendAddress.problem(baseWallet, on: bnb))
        XCTAssertEqual(SendAddress.problem(tronWallet, on: bnb), "That's a Tron address. Choose Tron above to send it there.")
        XCTAssertEqual(bnb.explorer(transaction: "0xabc")?.absoluteString, "https://bscscan.com/tx/0xabc")
    }

    func testReviewShowsTheFeeAndWhatArrivesBeforeAnythingCanBeSent() async throws {
        let flow = await makeFlow()
        flow.network = try network("solana", in: flow)
        flow.addressText = solanaWallet
        await flow.checkAddress()
        flow.enterAmount("10")
        XCTAssertFalse(flow.canSend, "No quote yet")

        await flow.prepare()
        XCTAssertEqual(flow.quote?.feeAmount, TokenAmount(baseUnits: 30_000))
        XCTAssertEqual(flow.quote?.receivesAmount, TokenAmount(baseUnits: 9_970_000))
        XCTAssertTrue(flow.canSend)

        flow.enterAmount("0.5")
        XCTAssertTrue(flow.isBelowMinimum)
        XCTAssertFalse(flow.canSend)
    }

    func testASendLeavesTheVaultLetsTheUserGoAndTurnsDeliveredWhenItLands() async throws {
        let vault = VaultStore(balance: TokenAmount(baseUnits: 50_000_000))
        let flow = WithdrawFlow(withdrawals: FixtureWithdrawals(), sends: FixtureSendsAPI(), vault: vault, recents: recents())
        flow.pollInterval = .zero
        await flow.loadNetworks()
        flow.network = try network("solana", in: flow)
        flow.addressText = solanaWallet
        await flow.checkAddress()
        flow.enterAmount("10")
        await flow.prepare()
        let quote = try XCTUnwrap(flow.quote)

        let sent = await flow.send()
        XCTAssertTrue(sent)
        XCTAssertEqual(vault.balance, TokenAmount(baseUnits: 40_000_000))
        XCTAssertEqual(flow.sent?.address, solanaWallet, "The receipt names the wallet, not the address it passed through")
        XCTAssertEqual(flow.sent?.crossing, true)
        XCTAssertEqual(flow.sent?.delivered, false, "Nobody is made to wait for the other network")
        XCTAssertEqual(WithdrawReviewView.headline(try XCTUnwrap(flow.sent)), "On its way to 4Nd1mYQzvg…eJcUuHsM")

        await flow.follow(quote)
        XCTAssertEqual(flow.sent?.delivered, true)
        XCTAssertEqual(flow.sent?.explorer?.absoluteString, "https://solscan.io/tx/demo")
    }

    func testASendToNEARIsStillFreeAndDirect() async {
        let flow = await makeFlow()
        flow.addressText = "rejois.near"
        await flow.checkAddress()
        flow.enterAmount("5")
        XCTAssertTrue(flow.canSend, "NEAR needs no quote")
        let sent = await flow.send()
        XCTAssertTrue(sent)
        XCTAssertEqual(flow.sent?.delivered, true)
        XCTAssertNil(flow.sent?.fee)
        XCTAssertNil(flow.quote)
    }
}
