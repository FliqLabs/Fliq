import Foundation
import Observation

/// The composition root. The app builds one from Info.plist; tests and previews pass
/// their own `api`, so no screen ever constructs a client itself.
@MainActor
@Observable
final class AppEnvironment {
    let api: any FliqAPI
    let router: AppRouter
    let biometrics: any Biometrics

    init(api: any FliqAPI, router: AppRouter = AppRouter(), biometrics: any Biometrics = DeviceBiometrics()) {
        self.api = api
        self.router = router
        self.biometrics = biometrics
    }

    static func live(bundle: Bundle = .main) -> AppEnvironment {
        let api = makeAPI(info: bundle.infoDictionary ?? [:], bundle: bundle)
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-testing") {
            return AppEnvironment(api: FixtureClient(bundle: bundle), biometrics: AlwaysApprove())
        }
        #endif
        return AppEnvironment(api: api)
    }

    static let preview = AppEnvironment(api: FixtureClient(), biometrics: AlwaysApprove())

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
