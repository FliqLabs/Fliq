import CryptoKit
import XCTest
@testable import Fliq

final class NEARTransactionTests: XCTestCase {
    // Built with near-api-js 7.4.0 `createTransaction` and `encodeTransaction` from the same inputs.
    private let referenceBase64 = "GQAAAG9saWVuLmZsaXFhY2NvdW50LnRlc3RuZXQA6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iwqAAAAAAAAAAwAAAB1c2RjLnRlc3RuZXTjPEZ4EjpajeXa1KQQ7G3aDG0Q8a0ipbnp0EcuY9zQowIAAAACDwAAAHN0b3JhZ2VfZGVwb3NpdDUAAAB7ImFjY291bnRfaWQiOiJib2IudGVzdG5ldCIsInJlZ2lzdHJhdGlvbl9vbmx5Ijp0cnVlfQCgck4YCQAAAABIVjcZPMNDAAAAAAAAAAILAAAAZnRfdHJhbnNmZXI+AAAAeyJyZWNlaXZlcl9pZCI6ImJvYi50ZXN0bmV0IiwiYW1vdW50IjoiMTUwMDAwMCIsIm1lbW8iOiJmbGlxIn0AQOWcMBIAAAEAAAAAAAAAAAAAAAAAAAA="
    private let referenceHash = "12a2f04444fdcc93bf7af9c3af8153b63dcbf5c2d42ca7723d699e32fc1b9dee"

    private func transfer(registration: Yocto?) throws -> NEARTransaction {
        .usdcTransfer(
            from: "olien.fliqaccount.testnet",
            to: "bob.testnet",
            units: 1_500_000,
            usdc: "usdc.testnet",
            registration: registration,
            nonce: 42,
            blockHash: try XCTUnwrap(NEARKey.base58Decode("GJ2rbiDPcN1R5y2hWjERXjfTsDp9XYnXXbJx8tjHYaRx")),
            publicKey: Data(hex: "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c")
        )
    }

    func testATransferWithRegistrationMatchesNearApiJs() throws {
        let transaction = try transfer(registration: Yocto(decimal: "1250000000000000000000"))
        XCTAssertEqual(transaction.borsh.base64EncodedString(), referenceBase64)
        XCTAssertEqual(transaction.signingHash.map { String(format: "%02x", $0) }.joined(), referenceHash)
    }

    func testARegisteredReceiverGetsOnlyTheTransfer() throws {
        let transaction = try transfer(registration: nil)
        XCTAssertEqual(transaction.calls.map(\.methodName), ["ft_transfer"])
        XCTAssertEqual(transaction.calls.first?.deposit, 1)
    }

    func testTheSignedTransactionCarriesAVerifiableSignature() throws {
        let key = Curve25519.Signing.PrivateKey()
        let transaction = NEARTransaction.usdcTransfer(
            from: "a.testnet", to: "b.testnet", units: 1, usdc: "usdc.testnet", registration: nil,
            nonce: 1, blockHash: Data(repeating: 0, count: 32), publicKey: key.publicKey.rawRepresentation
        )
        let signature = try key.signature(for: transaction.signingHash)
        let signed = try XCTUnwrap(Data(base64Encoded: transaction.signed(with: signature)))
        XCTAssertEqual(signed.prefix(transaction.borsh.count), transaction.borsh)
        XCTAssertEqual(signed.count, transaction.borsh.count + 1 + 64)
        XCTAssertTrue(key.publicKey.isValidSignature(signature, for: transaction.signingHash))
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

    func testTheFeeCheckCountsStorageAndRegistration() throws {
        let tenthOfANear = NEARRPC.Account(amount: "10000000000000000000000", storageUsage: 182)
        let registration = Yocto(decimal: "1250000000000000000000")
        XCTAssertTrue(RelayedWithdrawals.covers(tenthOfANear, registration: registration))
        let almostEmpty = NEARRPC.Account(amount: "7000000000000000000000", storageUsage: 182)
        XCTAssertTrue(RelayedWithdrawals.covers(almostEmpty, registration: nil))
        XCTAssertFalse(RelayedWithdrawals.covers(almostEmpty, registration: registration))
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

    func testACheckedAddressAndAnAmountInTheVaultCanBeSent() async {
        let vault = vault()
        let flow = WithdrawFlow(withdrawals: FixtureWithdrawals(), vault: vault)
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
        let flow = WithdrawFlow(withdrawals: FixtureWithdrawals(), vault: vault())
        flow.addressText = "bob.testnet"
        await flow.checkAddress()
        XCTAssertEqual(flow.check, .ready(needsSetup: false))
        flow.addressText = "bob.testne"
        XCTAssertNil(flow.check)
    }

    func testSendAllFillsTheVaultBalance() {
        let flow = WithdrawFlow(withdrawals: FixtureWithdrawals(), vault: vault())
        flow.useEverything()
        XCTAssertEqual(flow.amount, TokenAmount(baseUnits: 20_000_000))
    }

    func testAnUndeliveredTransferSaysWhereTheMoneyWaits() async {
        let vault = vault()
        var refreshed = false
        let flow = WithdrawFlow(withdrawals: Undelivered(), vault: vault, onLeftVault: { refreshed = true })
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
