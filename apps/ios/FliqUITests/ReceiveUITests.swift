import XCTest

/// Demo script step 1: pick Solana, get the address straight away, send 200 USDC and watch it land.
final class ReceiveUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testTopUpFromSolana() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--onboarded"]
        app.launch()

        app.buttons["Receive"].tap()
        let solana = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Solana")).firstMatch
        XCTAssertTrue(solana.waitForExistence(timeout: 3))
        snap("r1-sources")
        solana.tap()

        XCTAssertTrue(app.staticTexts["Demo address. Don't send real funds to it."].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["Any amount over $1"].exists, "No amount is asked for; the minimum is shown")
        snap("r2-address")
        app.buttons["I have sent it"].tap()

        XCTAssertTrue(app.staticTexts["in your vault"].waitForExistence(timeout: 12))
        snap("r3-landed")
        app.buttons["Back to vault"].tap()

        XCTAssertTrue(app.staticTexts["199.98"].waitForExistence(timeout: 3), "Home shows the new balance")
        snap("r4-home")
    }

    @MainActor
    private func snap(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        add(XCTAttachment(data: png, uniformTypeIdentifier: "public.png"))
        guard let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"] else { return }
        try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }
}
