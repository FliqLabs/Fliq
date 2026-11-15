import Foundation

/// Asks again after a failure that tends to pass on its own. Only for calls that are safe to repeat:
/// nothing that moves money or sends a person a message.
enum Retry {
    static let backoff: [Duration] = [.milliseconds(400), .seconds(1)]
    static let busyStatuses: Set<Int> = [502, 503, 504]

    /// One try, then one more after each delay, for as long as `shouldRetry` wants another.
    static func run<Value>(
        delays: [Duration] = backoff,
        sleep: (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        shouldRetry: (Result<Value, any Error>) -> Bool,
        _ operation: () async throws -> Value
    ) async throws -> Value {
        for delay in delays {
            let result: Result<Value, any Error>
            do {
                result = .success(try await operation())
            } catch {
                result = .failure(error)
            }
            guard shouldRetry(result), !Task.isCancelled else { return try result.get() }
            try await sleep(delay)
            try Task.checkCancellation()
        }
        return try await operation()
    }

    static func isNetworkFailure(_ error: any Error) -> Bool {
        guard let error = error as? URLError else { return false }
        return error.code != .cancelled
    }
}
