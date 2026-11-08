import XCTest
@testable import Fliq

/// Decodes responses saved from a running API, so a server that drifts from the spec fails here.
/// Skipped unless `TEST_RUNNER_LIVE_DIR` points at a folder of saved responses.
final class LiveResponseTests: XCTestCase {
    func testRealServerResponsesDecode() throws {
        guard let dir = ProcessInfo.processInfo.environment["LIVE_DIR"] else { throw XCTSkip("LIVE_DIR not set") }
        func check<T: Decodable>(_ file: String, _: T.Type) {
            do {
                let data = try Data(contentsOf: URL(fileURLWithPath: dir).appendingPathComponent("\(file).json"))
                _ = try FliqJSON.decoder().decode(T.self, from: data)
            } catch { XCTFail("\(file) as \(T.self): \(error)") }
        }
        check("email-link-sent", EmailLinkSent.self)
        check("session", Session.self)
        check("refresh", Session.self)
        check("me", User.self)
        check("me-update", User.self)
        check("name-claim", User.self)
        check("name-check", NameAvailability.self)
        check("vault", VaultBalance.self)
        check("institutions", InstitutionList.self)
        check("recipients", RecipientList.self)
        check("people-recent", RecentPeopleList.self)
        check("passkeys", PasskeyList.self)
        check("sessions", DeviceSessionList.self)
        check("rate", Rate.self)
        check("quote", Quote.self)
        check("verify", VerifiedAccount.self)
        check("payout-created", Payout.self)
        check("payout", Payout.self)
    }
}
