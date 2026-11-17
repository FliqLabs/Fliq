import XCTest

/// Naira in by bank transfer on the Paj fixture: amount, the one-time Paj check, the bank details, the tracker, done.
/// Set SCREENSHOT_DIR (as TEST_RUNNER_SCREENSHOT_DIR for xcodebuild) to save each screen.
final class BankDepositUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testNairaByBankTransferLandsInTheVault() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--onboarded"]
        app.launch()

        app.buttons["Transfer"].tap()
        XCTAssertTrue(app.buttons["Receive"].waitForExistence(timeout: 3))
        app.buttons["Receive"].tap()
        let bank = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Bank transfer")).firstMatch
        XCTAssertTrue(bank.waitForExistence(timeout: 3))
        bank.tap()

        XCTAssertTrue(app.staticTexts["Amount in naira"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "in your vault")).firstMatch.waitForExistence(timeout: 3))
        snap("d1-amount")
        app.buttons["Get bank details"].tap()

        if app.staticTexts["Confirm it's you"].waitForExistence(timeout: 3) {
            let contact = app.textFields.firstMatch
            contact.tap()
            // The app fills in the last email used on this device, so it is cleared before typing.
            let typed = (contact.value as? String) ?? ""
            contact.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: typed.count))
            contact.typeText("gift@entrypointlabs.xyz")
            snap("d2-check")
            app.buttons["Send code"].tap()
            let code = app.textFields["Code"]
            XCTAssertTrue(code.waitForExistence(timeout: 3))
            code.tap()
            code.typeText("2350")
            snap("d3-code")
            app.buttons["Confirm and get bank details"].tap()
        }

        XCTAssertTrue(app.staticTexts["Transfer exactly"].waitForExistence(timeout: 5))
        snap("d4-pay")
        app.buttons["I've sent the money"].tap()

        XCTAssertTrue(app.staticTexts["Checking with the bank"].waitForExistence(timeout: 3))
        snap("d5-checking")
        XCUIDevice.shared.press(.home)
        sleep(1)
        snap("d5a-dynamic-island")
        app.activate()
        // The user can leave as soon as the bank transfer is in: Done is there before the money has landed.
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 12))
        XCTAssertFalse(app.staticTexts["Transfer received"].exists, "No spinner to sit and watch")
        XCTAssertTrue(app.staticTexts["You paid"].waitForExistence(timeout: 3))
        snap("d5b-on-its-way")
        Thread.sleep(forTimeInterval: 1)
        snap("d6-done")
        app.buttons["Done"].tap()
        XCTAssertTrue(app.staticTexts["Vault balance"].waitForExistence(timeout: 5))
    }

    @MainActor
    private func snap(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        add(XCTAttachment(data: png, uniformTypeIdentifier: "public.png"))
        guard let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"] else { return }
        try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }
}
