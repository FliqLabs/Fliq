import XCTest

/// Welcome, a taken name and its suggestions, a free name, profile, own account, then Home.
final class OnboardingUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testFirstLaunchToHome() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()

        XCTAssertTrue(app.buttons["Continue with passkey"].waitForExistence(timeout: 5))
        snap("o1-welcome")
        app.buttons["Continue with passkey"].tap()

        let name = app.textFields["Name"]
        XCTAssertTrue(name.waitForExistence(timeout: 3))
        name.typeText("dara")
        XCTAssertTrue(app.staticTexts["Taken"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["dara-pay"].waitForExistence(timeout: 3), "A taken name offers free alternatives")
        snap("o2-name-taken")

        name.typeText(XCUIKeyboardKey.delete.rawValue + XCUIKeyboardKey.delete.rawValue + XCUIKeyboardKey.delete.rawValue + XCUIKeyboardKey.delete.rawValue)
        name.typeText("frank")
        XCTAssertTrue(app.staticTexts["Available"].waitForExistence(timeout: 3))
        snap("o3-name-available")
        app.buttons["Continue"].tap()

        XCTAssertTrue(app.staticTexts["Add a face to it"].waitForExistence(timeout: 3))
        snap("o4-profile")
        app.buttons["Continue"].tap()

        let number = app.textFields["Account number"]
        XCTAssertTrue(number.waitForExistence(timeout: 3))
        number.typeText("0123456789")
        XCTAssertTrue(app.staticTexts["DARA OKONKWO"].waitForExistence(timeout: 3))
        snap("o5-own-account")
        app.buttons["Continue"].tap()

        XCTAssertTrue(app.staticTexts["Vault balance"].waitForExistence(timeout: 5))
        snap("o6-home")
    }

    @MainActor
    private func snap(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        add(XCTAttachment(data: png, uniformTypeIdentifier: "public.png"))
        guard let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"] else { return }
        try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }
}
