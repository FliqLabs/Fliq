import XCTest

/// A refunded deposit shows on Home with the amount, and one tap brings it back to the vault.
final class RefundUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testARefundedDepositComesBackWithOneTap() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--onboarded", "--refund"]
        app.launch()

        let card = app.buttons["home.refund"]
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["$1.63 came back from a deposit"].exists)
        snap("f1-refund-card")
        card.tap()
        XCTAssertTrue(app.staticTexts["Back to your vault"].waitForExistence(timeout: 5))
        snap("f2-on-its-way")
    }

    @MainActor
    private func snap(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        add(XCTAttachment(data: png, uniformTypeIdentifier: "public.png"))
        guard let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"] else { return }
        try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }
}
