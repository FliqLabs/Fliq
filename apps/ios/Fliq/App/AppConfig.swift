import Foundation

enum AppConfig {
    static func makeAPI(bundle: Bundle = .main) -> any FliqAPI {
        let info = bundle.infoDictionary ?? [:]
        guard
            info["FliqDataSource"] as? String == "api",
            let base = (info["FliqAPIBaseURL"] as? String).flatMap(URL.init(string:))
        else {
            return FixtureClient(bundle: bundle)
        }
        return HTTPClient(baseURL: base, apiKey: info["FliqAPIKey"] as? String ?? "")
    }
}
