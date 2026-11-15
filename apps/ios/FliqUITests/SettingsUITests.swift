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
    func testDailyLimitIsSetAtOnceAndARaiseWaits() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--onboarded", "--funded"]
        app.launch()

        XCTAssertTrue(app.buttons["Profile"].waitForExistence(timeout: 5))
        app.buttons["Profile"].tap()
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Your daily limit")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 3))
        row.tap()
        XCTAssertTrue(app.staticTexts["No daily limit"].waitForExistence(timeout: 3))
        snap("l1-no-limit")

        app.buttons["Set a limit"].tap()
        XCTAssertTrue(app.buttons["Delete"].waitForExistence(timeout: 3))
        for key in ["5", "0", "0"] { app.buttons[key].tap() }
        snap("l2-typing")
        app.buttons["Save with Face ID"].tap()
        XCTAssertTrue(app.staticTexts["Most that can leave in a day"].waitForExistence(timeout: 3), "A first limit applies at once")
        snap("l3-limit-set")

        app.buttons["Change limit"].tap()
        XCTAssertTrue(app.buttons["Delete"].waitForExistence(timeout: 3))
        for key in ["2", "0", "0", "0"] { app.buttons[key].tap() }
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Takes effect in 24 hours")).firstMatch.waitForExistence(timeout: 3))
        snap("l4-raise")
        app.buttons["Save with Face ID"].tap()
        XCTAssertTrue(app.staticTexts["Going up to $2,000"].waitForExistence(timeout: 3), "A raise waits")
        snap("l5-raise-waiting")

        app.buttons["Cancel this change"].tap()
        XCTAssertTrue(app.staticTexts["Going up to $2,000"].waitForNonExistence(timeout: 3))
    }

    @MainActor
    func testAccountBackupIsTurnedOnFromSecurity() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--onboarded", "--funded"]
        app.launch()

        XCTAssertTrue(app.buttons["Profile"].waitForExistence(timeout: 5))
        app.buttons["Profile"].tap()
        let passkeys = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Passkeys")).firstMatch
        XCTAssertTrue(passkeys.waitForExistence(timeout: 3))
        passkeys.tap()
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Account backup")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 3))
        snap("b1-security")
        row.tap()
        XCTAssertTrue(app.staticTexts["Not backed up yet"].waitForExistence(timeout: 3))
        snap("b2-not-backed-up")

        app.buttons["Back up with Face ID"].tap()
        XCTAssertTrue(app.staticTexts["Your account is backed up"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.buttons["Back up with Face ID"].exists)
        snap("b3-backed-up")
    }

    @MainActor
    func testALostDeviceIsRemovedFromSecurity() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--onboarded", "--funded", "--lost-iphone"]
        app.launch()

        XCTAssertTrue(app.buttons["Profile"].waitForExistence(timeout: 5))
        app.buttons["Profile"].tap()
        let passkeys = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Passkeys")).firstMatch
        XCTAssertTrue(passkeys.waitForExistence(timeout: 3))
        passkeys.tap()
        XCTAssertTrue(app.staticTexts["Another device"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["This iPhone"].exists)
        snap("b5-devices")

        app.buttons["Remove"].tap()
        let confirm = app.buttons["Remove device"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 3))
        snap("b6-remove-confirm")
        confirm.tap()
        XCTAssertTrue(app.staticTexts["Another device"].waitForNonExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["This iPhone"].exists)
    }

    @MainActor
    func testANewIPhoneIsAskedToJoinTheAccountAndCanSendAfter() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--onboarded", "--funded", "--new-iphone"]
        app.launch()

        XCTAssertTrue(app.staticTexts["Add this iPhone to your account"].waitForExistence(timeout: 5))
        snap("b4-new-iphone")
        app.buttons["Add this iPhone with Face ID"].tap()
        XCTAssertTrue(app.staticTexts["Add this iPhone to your account"].waitForNonExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["Vault balance"].exists)
    }

    @MainActor
    private func snap(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        add(XCTAttachment(data: png, uniformTypeIdentifier: "public.png"))
        guard let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"] else { return }
        try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }
}
