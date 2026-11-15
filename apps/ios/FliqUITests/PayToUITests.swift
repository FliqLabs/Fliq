import XCTest

/// The Pay to sheet with a full list: browsing, a filter, and a search that finds someone by account digits.
final class PayToUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testBrowseFilterAndSearch() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--onboarded", "--sample-recipients"]
        app.launch()

        app.buttons["Transfer"].tap()
        XCTAssertTrue(app.buttons["Send"].waitForExistence(timeout: 3))
        app.buttons["Send"].tap()
        XCTAssertTrue(app.staticTexts["All recipients"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["Yours"].exists)
        snap("p1-pay-to")

        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "KES")).firstMatch.tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Wanjiru")).firstMatch.waitForExistence(timeout: 2))
        snap("p2-kes")

        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "All")).firstMatch.tap()
        let search = app.textFields["Search"]
        search.tap()
        search.typeText("3301")
        XCTAssertTrue(app.staticTexts["1 match"].waitForExistence(timeout: 2))
        snap("p3-search-digits")

        app.buttons["Clear search"].tap()
        search.typeText("ada")
        snap("p4-search-name")
    }

    @MainActor
    func testNewRecipientInUSDCOpensSendToAWallet() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--onboarded", "--funded", "--sample-recipients"]
        app.launch()

        app.buttons["Transfer"].tap()
        XCTAssertTrue(app.buttons["Send"].waitForExistence(timeout: 3))
        app.buttons["Send"].tap()
        XCTAssertTrue(app.buttons["New recipient"].waitForExistence(timeout: 3))
        app.buttons["New recipient"].tap()
        XCTAssertTrue(app.buttons["USDC"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["USDC"].isEnabled)
        XCTAssertFalse(app.buttons["GBP"].isEnabled)
        snap("p5-new-recipient-currency")

        app.buttons["USDC"].tap()
        XCTAssertTrue(app.buttons["Next"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["Vault"].exists)
        snap("p6-send-to-wallet")
    }

    /// The outlined button used to answer only a tap on its words. A thumb lands anywhere on it.
    @MainActor
    func testNextAnswersATapNearItsEdgeNotOnlyOnItsWords() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--onboarded", "--funded", "--sample-recipients"]
        app.launch()

        app.buttons["Transfer"].tap()
        XCTAssertTrue(app.buttons["Send"].waitForExistence(timeout: 3))
        app.buttons["Send"].tap()
        XCTAssertTrue(app.buttons["New recipient"].waitForExistence(timeout: 3))
        app.buttons["New recipient"].tap()
        XCTAssertTrue(app.buttons["USDC"].waitForExistence(timeout: 3))
        app.buttons["USDC"].tap()
        let next = app.buttons["Next"]
        XCTAssertTrue(next.waitForExistence(timeout: 3))
        app.buttons["5"].tap()

        next.coordinate(withNormalizedOffset: CGVector(dx: 0.06, dy: 0.5)).tap()
        XCTAssertTrue(app.staticTexts["To"].waitForExistence(timeout: 3), "One tap near the left edge moves on")
    }

    /// Send to a wallet on Solana: pick the network, paste, review the fee, send, and leave while it crosses.
    @MainActor
    func testSendToASolanaWalletShowsTheFeeAndDoesNotMakeTheUserWait() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--onboarded", "--funded", "--sample-recipients"]
        app.launch()

        app.buttons["Transfer"].tap()
        XCTAssertTrue(app.buttons["Send"].waitForExistence(timeout: 3))
        app.buttons["Send"].tap()
        XCTAssertTrue(app.buttons["New recipient"].waitForExistence(timeout: 3))
        app.buttons["New recipient"].tap()
        XCTAssertTrue(app.buttons["USDC"].waitForExistence(timeout: 3))
        app.buttons["USDC"].tap()
        XCTAssertTrue(app.buttons["Next"].waitForExistence(timeout: 3))
        app.buttons["1"].tap()
        app.buttons["0"].tap()
        app.buttons["Next"].tap()

        XCTAssertTrue(app.buttons["Solana"].waitForExistence(timeout: 3))
        snap("n1-networks")
        app.buttons["Solana"].tap()
        let field = app.textFields["Solana address"]
        XCTAssertTrue(field.waitForExistence(timeout: 3))
        field.tap()
        field.typeText("4Nd1mYQzvgV8Vr3Z3nYb7pD6T1K9wLx2aRkQeJcUuHsM")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "This looks like a Solana address")).firstMatch.waitForExistence(timeout: 3))
        snap("n2-address")
        app.buttons["Next"].tap()

        XCTAssertTrue(app.staticTexts["Network fee"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["$9.97"].waitForExistence(timeout: 3), "What arrives is shown before sending")
        snap("n3-review")
        app.buttons["Send with Face ID"].tap()

        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 5), "The user can leave at once")
        snap("n4-on-its-way")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Sent to")).firstMatch.waitForExistence(timeout: 15), "Someone who stays sees it land")
        snap("n5-delivered")
    }

    @MainActor
    private func snap(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        add(XCTAttachment(data: png, uniformTypeIdentifier: "public.png"))
        guard let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"] else { return }
        try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }
}
