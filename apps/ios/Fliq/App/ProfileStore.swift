import Foundation
import Observation

/// What the app remembers about its owner between launches. Nothing secret lives here:
/// keys go to the Keychain, and the bank account stays with the API.
@MainActor
@Observable
final class ProfileStore {
    private enum Key {
        static let onboarded = "profile.onboarded"
        static let name = "profile.name"
        static let displayName = "profile.displayName"
    }

    private(set) var isOnboarded: Bool
    private(set) var name: String?
    private(set) var displayName: String?

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        isOnboarded = defaults.bool(forKey: Key.onboarded)
        name = defaults.string(forKey: Key.name)
        displayName = defaults.string(forKey: Key.displayName)
    }

    func completeOnboarding(name: FliqName?, displayName: String?) {
        completeOnboarding(account: name?.account, displayName: displayName)
    }

    func completeOnboarding(account: String?, displayName: String?) {
        name = account
        self.displayName = displayName.flatMap { $0.isEmpty ? nil : $0 }
        isOnboarded = true
        defaults.set(true, forKey: Key.onboarded)
        defaults.set(self.name, forKey: Key.name)
        defaults.set(self.displayName, forKey: Key.displayName)
    }

    func signOut() {
        [Key.onboarded, Key.name, Key.displayName].forEach(defaults.removeObject(forKey:))
        isOnboarded = false
        name = nil
        displayName = nil
    }
}
