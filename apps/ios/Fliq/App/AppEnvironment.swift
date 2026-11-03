import Foundation
import Observation

/// The composition root. The app builds one from Info.plist; tests and previews pass
/// their own `api`, so no screen ever constructs a client itself.
@MainActor
@Observable
final class AppEnvironment {
    let api: any FliqAPI

    init(api: any FliqAPI) {
        self.api = api
    }

    static func live(bundle: Bundle = .main) -> AppEnvironment {
        AppEnvironment(api: makeAPI(info: bundle.infoDictionary ?? [:], bundle: bundle))
    }

    static let preview = AppEnvironment(api: FixtureClient())

    private static func makeAPI(info: [String: Any], bundle: Bundle) -> any FliqAPI {
        guard
            info["FliqDataSource"] as? String == "api",
            let base = (info["FliqAPIBaseURL"] as? String).flatMap(URL.init(string:))
        else {
            return FixtureClient(bundle: bundle)
        }
        return HTTPClient(baseURL: base, apiKey: info["FliqAPIKey"] as? String ?? "")
    }
}
