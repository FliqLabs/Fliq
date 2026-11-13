import UIKit
import UserNotifications

/// Push notifications for money events: asks once after sign-in, gives the APNs token to the API, shows a banner
/// even with the app open, and refreshes the balance and Activity whenever one arrives or is tapped.
@MainActor
final class PushNotifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushNotifications()

    private weak var environment: AppEnvironment?
    private var token: String?

    func start(_ environment: AppEnvironment) async {
        self.environment = environment
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        guard environment.isLive else { return }
        guard (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) == true else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    func registered(_ deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        self.token = token
        guard let environment, environment.isLive else { return }
        let device = PushDevice(token: token, environment: Self.apnsEnvironment, bundleId: Bundle.main.bundleIdentifier ?? "")
        Task { try? await environment.api.registerDevice(device) }
    }

    /// Called before the session ends, so the next person on this iPhone doesn't get the last one's pushes.
    func signOut() async {
        guard let token, let environment else { return }
        try? await environment.api.unregisterDevice(token: token)
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        await refresh()
        return [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        await refresh()
    }

    private func refresh() async {
        guard let environment else { return }
        await environment.refreshVault()
        await environment.refreshActivity()
    }

    /// Xcode builds carry a development provisioning profile and talk to APNs sandbox; TestFlight and the App Store
    /// use production.
    static var apnsEnvironment: String {
        guard
            let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
            let data = try? Data(contentsOf: url)
        else { return "production" }
        let text = String(decoding: data, as: UTF8.self)
        let development = text.range(of: "<key>aps-environment</key>\\s*<string>development</string>", options: .regularExpression)
        return development == nil ? "production" : "sandbox"
    }
}

final class FliqAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushNotifications.shared.registered(deviceToken)
    }
}
