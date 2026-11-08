import XCTest

/// Walks the demo payment on fixtures: Home, New account, Amount, Quote, Sending, Paid.
/// Set SCREENSHOT_DIR (as TEST_RUNNER_SCREENSHOT_DIR for xcodebuild) to save each screen.
final class PayFlowUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testPayDaraFromHomeToPaid() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--onboarded"]
        app.launch()

        XCTAssertTrue(app.staticTexts["Vault balance"].waitForExistence(timeout: 5))
        snap("1-home")

        app.buttons["Receive, send or request"].tap()
        XCTAssertTrue(app.buttons["Send"].waitForExistence(timeout: 3))
        app.buttons["Send"].tap()
        XCTAssertTrue(app.buttons["New recipient"].waitForExistence(timeout: 3))
        app.buttons["New recipient"].tap()
        let number = app.textFields["Account number"]
        XCTAssertTrue(number.waitForExistence(timeout: 3))
        number.typeText("0123456789")
        XCTAssertTrue(app.staticTexts["DARA OKONKWO"].waitForExistence(timeout: 3))
        snap("2-new-account")

        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["They receive"].waitForExistence(timeout: 3))
        app.buttons["5"].tap()
        app.buttons["0"].tap()
        snap("3-amount")

        app.buttons["Get quote"].tap()
        XCTAssertTrue(app.staticTexts["Rate held for"].waitForExistence(timeout: 3))
        snap("4-quote")

        app.buttons["Confirm with Face ID"].tap()
        let sending = app.staticTexts["Left your vault"].waitForExistence(timeout: 5)
        snap(sending ? "5-sending" : "5-sending-missing")
        XCTAssertTrue(sending)

        let paid = app.staticTexts["NIP session"].waitForExistence(timeout: 8)
        snap(paid ? "6-paid" : "6-paid-missing")
        XCTAssertTrue(paid)
    }

    @MainActor
    private func snap(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        add(XCTAttachment(data: png, uniformTypeIdentifier: "public.png"))
        guard let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"] else { return }
        try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }
}
