import XCTest
@testable import Fliq

@MainActor
final class OnboardingTests: XCTestCase {
    private func makeFlow() -> OnboardingFlow {
        OnboardingFlow(api: FixtureClient(), names: FixtureNameDirectory())
    }

    func testNameRules() {
        XCTAssertEqual(FliqName("Frank")?.account, "frank" + FliqName.suffix)
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

    func testACancelledCheckLeavesTheAnswerAlone() async throws {
        let flow = OnboardingFlow(api: FixtureClient(), names: CancellableDirectory())
        flow.nameText = "olien"
        let name = try XCTUnwrap(flow.name)
        await flow.resolve(name)
        XCTAssertEqual(flow.status, .available)

        let cancelled = Task { await flow.resolve(name) }
        cancelled.cancel()
        await cancelled.value

        XCTAssertEqual(flow.status, .available)
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
        XCTAssertEqual(relaunched.name, "frank" + FliqName.suffix)
        XCTAssertEqual(relaunched.displayName, "Frank")

        relaunched.signOut()
        XCTAssertFalse(ProfileStore(defaults: defaults).isOnboarded)
    }
}

/// Fails the way URLSession does when the check's task is cancelled by the next keystroke.
private struct CancellableDirectory: NameDirectory {
    func isAvailable(_ name: FliqName) async throws -> Bool {
        if Task.isCancelled { throw URLError(.cancelled) }
        return true
    }

    func testAPasskeyTheServerDoesNotKnowLeadsToCreatingAnAccount() {
        let detail = ErrorBody.Detail(code: "unauthorized", message: "Unknown passkey.")
        XCTAssertTrue(OnboardingView.isRejectedPasskey(.unexpected(status: 401)))
        XCTAssertTrue(OnboardingView.isRejectedPasskey(.server(status: 401, detail)))
        XCTAssertFalse(OnboardingView.isRejectedPasskey(.unexpected(status: 503)))
    }
}
