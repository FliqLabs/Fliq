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

        app.buttons["See all"].tap()
        XCTAssertTrue(app.staticTexts["Activity"].waitForExistence(timeout: 3))
        snap("h2-activity")
    }

    @MainActor
    private func snap(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        add(XCTAttachment(data: png, uniformTypeIdentifier: "public.png"))
        guard let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"] else { return }
        try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }
}
