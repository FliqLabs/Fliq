import XCTest
@testable import Fliq

/// SOL, ETH and BNB: a chain's own coin, swapped to dollars as it lands.
final class DepositCoinsTests: XCTestCase {
    func testCoinsAreSwappedAndDrawnWithTheRightBadge() {
        let sol = DepositSource(tokenId: "sol", chainId: "solana", group: .coins)
        let ethOnBase = DepositSource(tokenId: "eth", chainId: "base", group: .coins)
        let usdc = DepositSource(tokenId: "usdc", chainId: "solana", group: .dollars)
        XCTAssertTrue(sol.isSwapped)
        XCTAssertTrue(sol.isNativeCoin, "SOL on Solana needs no network badge")
        XCTAssertFalse(ethOnBase.isNativeCoin, "ETH on Base shows the Base badge")
        XCTAssertFalse(usdc.isSwapped)
        XCTAssertEqual(DepositSource.Group.coins.title, "Other coins")
        XCTAssertEqual(DepositSource.Group(rawValue: "coins"), .coins)
    }

    func testAMinimumWithMoreThanSixDecimalsIsRoundedUpNeverDown() {
        XCTAssertEqual(TokenAmount(roundingUp: "0.000980123456789")?.decimalString, "0.000981")
        XCTAssertEqual(TokenAmount(roundingUp: "0.003000000000000")?.decimalString, "0.003")
        XCTAssertNil(TokenAmount(roundingUp: "0.03"), "Six decimals or fewer parse the normal way")
    }
}
