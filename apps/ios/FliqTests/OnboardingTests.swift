import XCTest
@testable import Fliq

@MainActor
final class OnboardingTests: XCTestCase {
    private func makeFlow() -> OnboardingFlow {
        OnboardingFlow(api: FixtureClient(), names: FixtureNameDirectory())
    }

    func testNameRules() {
        XCTAssertEqual(FliqName("Frank")?.account, "frank.fliq.near")
        XCTAssertEqual(FliqName("dara-o")?.value, "dara-o")
        for bad in ["a", "-frank", "frank-", "fr--ank", "frank.near", "frånk", "f rank", String(repeating: "a", count: 33)] {
            XCTAssertNil(FliqName(bad), bad)
        }
    }

    func testAvailableName() async throws {
        let flow = makeFlow()
        flow.nameText = "frank"
        XCTAssertEqual(flow.status, .checking)

        await flow.resolve(try XCTUnwrap(flow.name))
        XCTAssertEqual(flow.status, .available)
        XCTAssertTrue(flow.canClaim)
    }

    func testTakenNameOffersFreeAlternatives() async throws {
        let flow = makeFlow()
        flow.displayName = "Dara Okonkwo"
        flow.nameText = "dara"

        await flow.resolve(try XCTUnwrap(flow.name))
        XCTAssertEqual(flow.status, .taken)
        XCTAssertFalse(flow.canClaim)
        XCTAssertEqual(flow.suggestions.first, "dara-d")
        XCTAssertFalse(flow.suggestions.contains("dara"))
        XCTAssertLessThanOrEqual(flow.suggestions.count, 3)
    }

    func testInvalidNameIsNotChecked() {
        let flow = makeFlow()
        flow.nameText = "-x"
        XCTAssertEqual(flow.status, .invalid)
        flow.nameText = ""
        XCTAssertEqual(flow.status, .empty)
    }

    func testProfileSurvivesRelaunch() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: #function))
        defaults.removePersistentDomain(forName: #function)

        ProfileStore(defaults: defaults).completeOnboarding(name: FliqName("frank"), displayName: "Frank")
        let relaunched = ProfileStore(defaults: defaults)

        XCTAssertTrue(relaunched.isOnboarded)
        XCTAssertEqual(relaunched.name, "frank.fliq.near")
        XCTAssertEqual(relaunched.displayName, "Frank")

        relaunched.signOut()
        XCTAssertFalse(ProfileStore(defaults: defaults).isOnboarded)
    }
}
