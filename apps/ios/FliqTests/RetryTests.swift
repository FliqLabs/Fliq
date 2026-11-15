import XCTest
@testable import Fliq

final class RetryTests: XCTestCase {
    private static let dropped = URLError(.networkConnectionLost)

    private static func afterNetworkFailure(_ result: Result<String, any Error>) -> Bool {
        guard case .failure(let error) = result else { return false }
        return Retry.isNetworkFailure(error)
    }

    func testAFailureWorthRetryingIsTriedAgainUntilItWorks() async throws {
        var attempts = 0
        var waits: [Duration] = []

        let value = try await Retry.run(sleep: { waits.append($0) }, shouldRetry: Self.afterNetworkFailure) {
            attempts += 1
            if attempts < 3 { throw Self.dropped }
            return "address"
        }

        XCTAssertEqual(value, "address")
        XCTAssertEqual(attempts, 3)
        XCTAssertEqual(waits, [.milliseconds(400), .seconds(1)])
    }

    func testSuccessIsNotAskedAgain() async throws {
        var attempts = 0

        _ = try await Retry.run(sleep: { _ in XCTFail("Nothing to wait for") }, shouldRetry: Self.afterNetworkFailure) {
            attempts += 1
            return "address"
        }

        XCTAssertEqual(attempts, 1)
    }

    func testAFailureNotWorthRetryingStopsAtOnce() async {
        var attempts = 0

        do {
            _ = try await Retry.run(sleep: { _ in XCTFail("Nothing to wait for") }, shouldRetry: Self.afterNetworkFailure) {
                attempts += 1
                throw APIError.unexpected(status: 400)
            }
            XCTFail("The refusal should come through")
        } catch {
            XCTAssertEqual(error as? APIError, .unexpected(status: 400))
        }
        XCTAssertEqual(attempts, 1)
    }

    func testItGivesUpAfterOneTryPerDelayAndOneMore() async {
        var attempts = 0

        do {
            _ = try await Retry.run(delays: [.zero, .zero, .zero], sleep: { _ in }, shouldRetry: Self.afterNetworkFailure) {
                attempts += 1
                throw Self.dropped
            }
            XCTFail("The last failure should come through")
        } catch {
            XCTAssertEqual((error as? URLError)?.code, .networkConnectionLost)
        }
        XCTAssertEqual(attempts, 4)
    }

    func testAResultCanAskForAnotherTry() async throws {
        var attempts = 0

        let status = try await Retry.run(sleep: { _ in }, shouldRetry: { (try? $0.get()) == 503 }) {
            attempts += 1
            return attempts == 1 ? 503 : 200
        }

        XCTAssertEqual(status, 200)
        XCTAssertEqual(attempts, 2)
    }

    func testCancellingWhileWaitingStopsTheRetries() async {
        var attempts = 0

        do {
            _ = try await Retry.run(sleep: { _ in withUnsafeCurrentTask { $0?.cancel() } }, shouldRetry: Self.afterNetworkFailure) {
                attempts += 1
                throw Self.dropped
            }
            XCTFail("A cancelled task should not finish")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
        XCTAssertEqual(attempts, 1)
    }

    func testACancelledTaskDoesNotWaitOrTryAgain() async {
        var attempts = 0

        do {
            _ = try await Retry.run(sleep: { _ in XCTFail("A cancelled task should not wait") }, shouldRetry: Self.afterNetworkFailure) {
                attempts += 1
                withUnsafeCurrentTask { $0?.cancel() }
                throw Self.dropped
            }
            XCTFail("The failure should come through")
        } catch {
            XCTAssertEqual((error as? URLError)?.code, .networkConnectionLost)
        }
        XCTAssertEqual(attempts, 1)
    }

    func testACancelledRequestIsNotANetworkFailure() {
        XCTAssertFalse(Retry.isNetworkFailure(URLError(.cancelled)))
        XCTAssertTrue(Retry.isNetworkFailure(URLError(.timedOut)))
        XCTAssertFalse(Retry.isNetworkFailure(APIError.unexpected(status: 500)))
    }
}
