import XCTest

/// Demo script step 3: Claude's spend against its cap, the refused ₦500,000, then limits and revoke.
final class AgentsUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testAgentsLimitsAndRevoke() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--onboarded"]
        app.launch()

        app.buttons["Menu"].tap()
        let agentsRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Agents")).firstMatch
        XCTAssertTrue(agentsRow.waitForExistence(timeout: 3))
        agentsRow.tap()
        XCTAssertTrue(app.staticTexts["Spent today"].waitForExistence(timeout: 3))
        let refused = app.otherElements.matching(NSPredicate(format: "label CONTAINS %@", "Refused")).firstMatch
        XCTAssertTrue(refused.exists || app.staticTexts["Refused"].exists, "The refused ₦500,000 is listed")
        snap("g1-agents")

        app.buttons["Change limits"].tap()
        XCTAssertTrue(app.buttons["Save with Face ID"].waitForExistence(timeout: 3))
        app.buttons["More per day"].tap()
        snap("g2-limits")
        app.buttons["Save with Face ID"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "160,000")).firstMatch
            .waitForExistence(timeout: 3))

        app.buttons["Revoke key"].tap()
        XCTAssertTrue(app.buttons["Revoke with Face ID"].waitForExistence(timeout: 3))
        snap("g3-revoke")
        app.buttons["Revoke with Face ID"].tap()
        XCTAssertTrue(app.staticTexts["Key revoked. It can't pay from your vault."].waitForExistence(timeout: 3))

        app.buttons["Connect an agent"].tap()
        XCTAssertTrue(app.buttons["agent-app-claude"].waitForExistence(timeout: 3))
        snap("g4-choose-app")
        app.buttons["agent-app-claude"].tap()
        XCTAssertTrue(app.buttons["Connect with Face ID"].waitForExistence(timeout: 3))
        snap("g5-limits")
        app.buttons["Connect with Face ID"].tap()
        XCTAssertTrue(app.staticTexts["Claude is connected"].waitForExistence(timeout: 5))
        snap("g6-connected")
        app.swipeUp()
        snap("g7-setup")
        app.buttons["Done"].tap()
        XCTAssertTrue(app.staticTexts["Spent today"].waitForExistence(timeout: 3))
        snap("g8-list")
    }

    @MainActor
    private func snap(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        add(XCTAttachment(data: png, uniformTypeIdentifier: "public.png"))
        guard let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"] else { return }
        try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }
}
