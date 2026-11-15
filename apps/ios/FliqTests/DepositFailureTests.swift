import XCTest
@testable import Fliq

@MainActor
final class DepositFailureTests: XCTestCase {
    private func detail(_ code: String, _ message: String) -> ErrorBody.Detail {
        ErrorBody.Detail(code: code, message: message)
    }

    func testNoInternetSaysOffline() {
        for code in [URLError.Code.notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .dnsLookupFailed] {
            XCTAssertEqual(DepositFailure.message(for: URLError(code)), "You're offline. Check your connection and try again.")
        }
    }

    func testATimeoutSaysItIsSlowNotThatTheUserIsOffline() {
        XCTAssertEqual(DepositFailure.message(for: URLError(.timedOut)), "This is taking longer than usual. Try again in a moment.")
    }

    func testPajsOwnRefusalKeepsPajsWords() {
        XCTAssertEqual(DepositFailure.message(for: Paj.Failure(message: "That code has expired.")), "That code has expired.")
    }

    func testTheAPIsOwnWordsAreShownWhenTheyAreWrittenForPeople() {
        let error = APIError.server(status: 404, detail("not_found", "Claim a fliq name to get a vault."))
        XCTAssertEqual(DepositFailure.message(for: error), "Claim a fliq name to get a vault.")
    }

    func testTechnicalAPIErrorsSayTheDepositWasNotSetUp() {
        let notSetUp = "We couldn't set up your deposit. Nothing was charged. Try again."
        XCTAssertEqual(DepositFailure.message(for: APIError.server(status: 400, detail("invalid_request", "amount must be a positive decimal string."))), notSetUp)
        XCTAssertEqual(DepositFailure.message(for: APIError.server(status: 500, detail("internal", "Unexpected error."))), notSetUp)
        XCTAssertEqual(DepositFailure.message(for: APIError.unexpected(status: 502)), notSetUp)
        XCTAssertEqual(DepositFailure.message(for: DepositUnavailable(message: "NEAR Intents will not take this amount from solana.")), notSetUp)
    }

    func testAnExpiredSessionAsksToSignInAgain() {
        XCTAssertEqual(DepositFailure.message(for: APIError.unexpected(status: 401)), "Sign in to fliq again first.")
        XCTAssertEqual(DepositFailure.message(for: APIError.server(status: 401, detail("unauthorized", "Missing or invalid credentials."))), "Sign in to fliq again first.")
    }

    func testAnythingElseIsOnUs() {
        let ours = "Something went wrong on our side. Nothing was charged. Try again."
        XCTAssertEqual(DepositFailure.message(for: URLError(.cannotConnectToHost)), ours)
        XCTAssertEqual(DepositFailure.message(for: DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: ""))), ours)
    }

    func testAFailedAddressInTheBankFlowIsNotBlamedOnPajOrTheConnection() async {
        let paj = FixturePaj()
        let flow = BankDepositFlow(paj: paj, signIn: paj, sessions: nil) {
            throw DepositUnavailable(message: "NEAR Intents will not take this amount from solana.")
        }
        await flow.getBankDetails()
        flow.contact = "ada@example.com"
        await flow.sendCode()
        flow.code = "1234"

        await flow.verify()

        XCTAssertEqual(flow.errorMessage, "We couldn't set up your deposit. Nothing was charged. Try again.")
        XCTAssertFalse(flow.isWorking)
        XCTAssertEqual(flow.step, .signIn)
    }

    func testAFailedAddressInReceiveSaysWhatHappened() async throws {
        let flow = ReceiveFlow(api: TimingOut(), vault: VaultStore(), vaultAccount: "ada.fliq.near")

        let reserved = await flow.reserve(DepositSource(tokenId: "usdc", chainId: "solana", group: .dollars))

        XCTAssertFalse(reserved)
        XCTAssertEqual(flow.errorMessage, "This is taking longer than usual. Try again in a moment.")
    }

    private struct TimingOut: DepositAPI {
        func sources() async throws -> [DepositSource] { [] }
        func reserve(_ source: DepositSource, vault: String) async throws -> DepositAddress { throw URLError(.timedOut) }
        func status(of deposit: DepositAddress) async throws -> DepositStatus { throw URLError(.timedOut) }
    }
}
