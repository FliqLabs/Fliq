import XCTest

/// Opens the routes, sends $13 to see the refund, then checks Activity lists it.
final class ActivityUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testRoutesRefundAndActivity() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--onboarded"]
        app.launch()

        app.buttons["Activity"].tap()
        XCTAssertTrue(app.staticTexts["Nothing yet"].waitForExistence(timeout: 3))
        snap("a1-activity-empty")
        XCTAssertTrue(app.buttons["Transfer"].exists, "The action bar stays under Activity")
        app.buttons["Home"].tap()

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
        app.buttons["1"].tap()
        app.buttons["3"].tap()
        app.buttons["Get quote"].tap()

        XCTAssertTrue(app.staticTexts["Best of 4"].waitForExistence(timeout: 3))
        app.staticTexts["Best of 4"].tap()
        XCTAssertTrue(app.staticTexts["Sorted by what lands after every fee"].waitForExistence(timeout: 3))
        snap("a2-routes")
        app.buttons["Close"].tap()

        app.buttons["Confirm with Face ID"].tap()
        XCTAssertTrue(app.buttons["Keep it in the vault"].waitForExistence(timeout: 10))
        snap("a3-refunded")
        app.buttons["Keep it in the vault"].tap()

        app.buttons["Activity"].tap()
        let refundedRow = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Refunded")).firstMatch
        XCTAssertTrue(refundedRow.waitForExistence(timeout: 3))
        snap("a4-activity")
    }

    @MainActor
    private func snap(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        add(XCTAttachment(data: png, uniformTypeIdentifier: "public.png"))
        guard let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"] else { return }
        try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }
}
