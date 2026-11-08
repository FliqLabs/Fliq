import XCTest

/// Demo script step 1: Receive from an external wallet, USDC on Solana, then watch 200 USDC land.
final class ReceiveUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testTopUpFromSolana() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--onboarded"]
        app.launch()

        app.buttons["Transfer"].tap()
        XCTAssertTrue(app.buttons["Receive"].waitForExistence(timeout: 3))
        snap("r0-move-money")
        app.buttons["Receive"].tap()

        XCTAssertTrue(app.buttons["External wallet"].waitForExistence(timeout: 3))
        snap("r1-how")
        app.buttons["External wallet"].tap()

        XCTAssertTrue(app.buttons["USDC"].waitForExistence(timeout: 3))
        snap("r2-currency")
        app.buttons["USDC"].tap()

        let solana = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Solana")).firstMatch
        XCTAssertTrue(solana.waitForExistence(timeout: 3))
        snap("r3-network")
        solana.tap()

        XCTAssertTrue(app.staticTexts["Receive USDC"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Copy address"].exists)
        snap("r4-address")

        XCTAssertTrue(app.staticTexts["in your vault"].waitForExistence(timeout: 20))
        snap("r5-landed")
        app.buttons["Back to vault"].tap()

        XCTAssertTrue(app.staticTexts["199.98"].waitForExistence(timeout: 3), "Home shows the new balance")
        snap("r6-home")
    }

    @MainActor
    private func snap(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        add(XCTAttachment(data: png, uniformTypeIdentifier: "public.png"))
        guard let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"] else { return }
        try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }
}
