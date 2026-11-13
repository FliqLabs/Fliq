import XCTest

/// App Design v5 Home: the Recent card with the two newest rows, See all to Activity, and a payout opening its receipt.
final class HomeRecentUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testRecentShowsTheNewestTwoAndSeeAllOpensActivity() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--onboarded", "--funded", "--sample-activity"]
        app.launch()

        XCTAssertTrue(app.staticTexts["RECENT"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Received from Solana"].exists || app.staticTexts["DARA OKONKWO"].exists)
        snap("h1-home-recent")

        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "DARA OKONKWO")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Category"].waitForExistence(timeout: 3))
        snap("h2-detail-from-home")
        app.buttons["Close"].firstMatch.tap()

        app.buttons["See all"].tap()
        XCTAssertTrue(app.staticTexts["Activity"].waitForExistence(timeout: 3))
        snap("h3-activity")

        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Received from Solana")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Delivered to your vault"].waitForExistence(timeout: 3))
        snap("h4-deposit-detail")
        app.buttons["Close"].firstMatch.tap()

        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Refused")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Refused by your vault"].waitForExistence(timeout: 3))
        snap("h5-refused-detail")
    }

    @MainActor
    func testTappingYourPhotoInSettingsOpensEditAvatar() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--onboarded"]
        app.launch()

        app.buttons["Profile"].tap()
        let avatar = app.buttons["Edit avatar"]
        XCTAssertTrue(avatar.waitForExistence(timeout: 5))
        avatar.tap()
        XCTAssertTrue(app.staticTexts["Edit avatar"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Add photo"].exists || app.buttons["Change photo"].exists)
        snap("h6-edit-avatar")
    }

    @MainActor
    private func snap(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        add(XCTAttachment(data: png, uniformTypeIdentifier: "public.png"))
        guard let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"] else { return }
        try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }
}
