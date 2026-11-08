import XCTest

/// The Pay to sheet with a full list: browsing, a filter, and a search that finds someone by account digits.
final class PayToUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testBrowseFilterAndSearch() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--onboarded", "--sample-recipients"]
        app.launch()

        app.buttons["Send, receive or request"].tap()
        XCTAssertTrue(app.buttons["Send"].waitForExistence(timeout: 3))
        app.buttons["Send"].tap()
        XCTAssertTrue(app.staticTexts["All recipients"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["Yours"].exists)
        snap("p1-pay-to")

        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "KES")).firstMatch.tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Wanjiru")).firstMatch.waitForExistence(timeout: 2))
        snap("p2-kes")

        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "All")).firstMatch.tap()
        let search = app.textFields["Search"]
        search.tap()
        search.typeText("3301")
        XCTAssertTrue(app.staticTexts["1 match"].waitForExistence(timeout: 2))
        snap("p3-search-digits")

        app.buttons["Clear search"].tap()
        search.typeText("ada")
        snap("p4-search-name")
    }

    @MainActor
    private func snap(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        add(XCTAttachment(data: png, uniformTypeIdentifier: "public.png"))
        guard let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"] else { return }
        try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }
}
