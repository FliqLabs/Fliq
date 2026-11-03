import XCTest

/// Demo script step 1: top up 200 USDC from Solana and watch it land in the vault.
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

        XCTAssertTrue(app.staticTexts["About how much will you send?"].waitForExistence(timeout: 3))
        for key in ["2", "0", "0"] { app.buttons[key].tap() }
        snap("r2-amount")
        app.buttons["Get address"].tap()

        XCTAssertTrue(app.staticTexts["Demo address. Don't send real funds to it."].waitForExistence(timeout: 3))
        snap("r3-address")
        app.buttons["I have sent it"].tap()

        XCTAssertTrue(app.staticTexts["in your vault"].waitForExistence(timeout: 12))
        snap("r4-landed")
        app.buttons["Back to vault"].tap()

        XCTAssertTrue(app.staticTexts["199.98"].waitForExistence(timeout: 3), "Home shows the new balance")
        snap("r5-home")
    }

    @MainActor
    private func snap(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        add(XCTAttachment(data: png, uniformTypeIdentifier: "public.png"))
        guard let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"] else { return }
        try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }
}
