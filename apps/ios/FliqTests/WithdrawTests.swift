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

@MainActor
final class WithdrawFlowTests: XCTestCase {
    private struct Undelivered: Withdrawals {
        func check(_ address: String) async -> AddressCheck { .ready(needsSetup: true) }
        func send(_ amount: TokenAmount, to address: String) async throws -> WithdrawReceipt {
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
        XCTAssertTrue(flow.needsSetup)
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
