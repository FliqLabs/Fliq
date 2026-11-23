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

    /// After a deposit is seen it shows on the Lock Screen and in the Dynamic Island, so the user can leave the app.
    @MainActor
    func testADepositShowsOutsideTheApp() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--onboarded"]
        app.launch()

        app.buttons["Transfer"].tap()
        XCTAssertTrue(app.buttons["Receive"].waitForExistence(timeout: 3))
        app.buttons["Receive"].tap()
        XCTAssertTrue(app.buttons["External wallet"].waitForExistence(timeout: 3))
        app.buttons["External wallet"].tap()
        XCTAssertTrue(app.buttons["USDC"].waitForExistence(timeout: 3))
        app.buttons["USDC"].tap()
        let solana = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Solana")).firstMatch
        XCTAssertTrue(solana.waitForExistence(timeout: 3))
        solana.tap()
        XCTAssertTrue(app.staticTexts["in your vault"].waitForExistence(timeout: 20))

        XCUIDevice.shared.press(.home)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        XCTAssertTrue(springboard.wait(for: .runningForeground, timeout: 5))
        sleep(2)
        snap("l1-home-dynamic-island")
        let lock = NSSelectorFromString("pressLockButton")
        guard XCUIDevice.shared.responds(to: lock) else { return }
        XCUIDevice.shared.perform(lock)
        sleep(2)
        XCUIDevice.shared.perform(lock)
        sleep(2)
        snap("l2-lock-screen")
    }

    @MainActor
    private func snap(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        add(XCTAttachment(data: png, uniformTypeIdentifier: "public.png"))
        guard let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"] else { return }
        try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }
}
