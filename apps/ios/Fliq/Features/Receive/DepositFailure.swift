import Foundation

/// What to tell someone when setting up a deposit fails: what really happened, in plain words.
enum DepositFailure {
    static let offline = "You're offline. Check your connection and try again."
    static let slow = "This is taking longer than usual. Try again in a moment."
    static let signedOut = "Sign in to fliq again first."
    static let notSetUp = "We couldn't set up your deposit. Nothing was charged. Try again."
    static let ours = "Something went wrong on our side. Nothing was charged. Try again."

    private static let offlineCodes: Set<URLError.Code> = [
        .notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .dnsLookupFailed, .dataNotAllowed, .internationalRoamingOff,
    ]

    /// Codes whose message the API wrote for developers, not for the person holding the phone.
    private static let technicalCodes: Set<String> = [
        "invalid_request", "forbidden", "internal", "idempotency_key_required", "idempotency_mismatch",
    ]

    static func message(for error: any Error) -> String {
        switch error {
        case let failure as Paj.Failure:
            failure.message
        case let error as URLError where error.code == .timedOut:
            slow
        case let error as URLError where offlineCodes.contains(error.code):
            offline
        case APIError.server(status: 401, _), APIError.unexpected(status: 401):
            signedOut
        case APIError.server(let status, let detail) where status < 500 && !technicalCodes.contains(detail.code):
            detail.message
        case is APIError, is DepositUnavailable:
            notSetUp
        default:
            ours
        }
    }
}
