import XCTest

/// Pays Dara with "Save this account" on, then finds Dara under Settings > Your accounts.
final class SettingsUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testSettingsAccountsSecurityNotifications() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--onboarded", "--funded"]
        app.launch()

        app.buttons["Transfer"].tap()
        XCTAssertTrue(app.buttons["Send"].waitForExistence(timeout: 3))
        app.buttons["Send"].tap()
        XCTAssertTrue(app.buttons["New recipient"].waitForExistence(timeout: 3))
        app.buttons["New recipient"].tap()
        XCTAssertTrue(app.buttons["NGN"].waitForExistence(timeout: 3))
        app.buttons["NGN"].tap()
        XCTAssertTrue(app.buttons["Bank transfer"].waitForExistence(timeout: 3))
        app.buttons["Bank transfer"].tap()
        let number = app.textFields["Account number"]
        XCTAssertTrue(number.waitForExistence(timeout: 3))
        number.tap()
        number.typeText("0123456789")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "DARA OKONKWO")).firstMatch.waitForExistence(timeout: 3))
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.buttons["Delete"].waitForExistence(timeout: 3), "The amount screen has its own keypad")
        XCTAssertFalse(app.keyboards.firstMatch.exists, "No system keyboard for amounts")
        app.buttons["5"].tap()
        app.buttons["Get quote"].tap()
        XCTAssertTrue(app.buttons["Confirm with Face ID"].waitForExistence(timeout: 3))
        app.buttons["Confirm with Face ID"].tap()
        let close = app.buttons["Close"]
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        close.tap()

        app.buttons["Profile"].tap()
        XCTAssertTrue(app.staticTexts["Live rates, all providers"].waitForExistence(timeout: 3))
        snap("s1-settings")

        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Your bank account")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["DARA OKONKWO"].waitForExistence(timeout: 3), "The paid recipient was saved")
        snap("s2-accounts")
        app.buttons["BackButton"].tap()

        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Passkeys")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Face ID to send"].waitForExistence(timeout: 3))
        snap("s3-security")
        app.buttons["BackButton"].tap()

        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Notifications")).firstMatch.tap()
        XCTAssertTrue(app.switches.firstMatch.waitForExistence(timeout: 3))
        snap("s4-notifications")
        app.buttons["BackButton"].tap()

        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Live rates")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Official close"].waitForExistence(timeout: 3))
        snap("s5-rates")
    }

    @MainActor
    private func snap(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        add(XCTAttachment(data: png, uniformTypeIdentifier: "public.png"))
        guard let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"] else { return }
        try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }
}
