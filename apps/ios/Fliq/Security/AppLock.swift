import CommonCrypto
import Foundation
import LocalAuthentication
import Observation

/// Locks the app behind Face ID or a six-digit passcode, on launch and after time in the background.
/// The passcode itself is never stored: only a salted PBKDF2 hash, in the Keychain.
@MainActor
@Observable
final class AppLock {
    enum Delay: Int, CaseIterable, Identifiable, Sendable {
        case immediately = 0
        case oneMinute = 60
        case fiveMinutes = 300

        var id: Int { rawValue }
        var title: String {
            switch self {
            case .immediately: "Immediately"
            case .oneMinute: "After 1 minute"
            case .fiveMinutes: "After 5 minutes"
            }
        }
    }

    enum Attempt: Equatable {
        case unlocked
        case wrong(left: Int)
        case wait(until: Date)
    }

    struct Hashed: Codable, Equatable, Sendable {
        let salt: Data
        let hash: Data
    }

    private enum Key {
        static let asked = "lock.asked"
        static let biometrics = "lock.biometrics"
        static let delay = "lock.delay"
        static let failures = "lock.failures"
        static let waitUntil = "lock.waitUntil"
        static let passcode = "lock.passcode"
    }

    static let passcodeLength = 6
    static let triesBeforeWait = 5
    static let firstWait: TimeInterval = 30

    private(set) var isLocked = false
    private(set) var asked: Bool
    private(set) var usesBiometrics: Bool
    private(set) var hasPasscode: Bool
    private(set) var delay: Delay
    private(set) var waitUntil: Date?

    private var failures: Int
    private var backgroundedAt: Date?
    private let defaults: UserDefaults
    private let keychain: Keychain?
    private var memoryPasscode: Hashed?
    private let now: () -> Date

    /// Pass `keychain: nil` to keep the passcode in memory (tests, UI testing).
    init(defaults: UserDefaults = .standard, keychain: Keychain? = Keychain(service: "cash.fliq.lock"), now: @escaping () -> Date = Date.init) {
        self.defaults = defaults
        self.keychain = keychain
        self.now = now
        asked = defaults.bool(forKey: Key.asked)
        usesBiometrics = defaults.bool(forKey: Key.biometrics)
        delay = defaults.object(forKey: Key.delay) == nil ? .oneMinute : Delay(rawValue: defaults.integer(forKey: Key.delay)) ?? .oneMinute
        failures = defaults.integer(forKey: Key.failures)
        waitUntil = defaults.object(forKey: Key.waitUntil) as? Date
        hasPasscode = keychain?.load(Hashed.self, for: Key.passcode) != nil
    }

    /// A lock that never asks and never locks, for UI tests and previews.
    static func off() -> AppLock {
        let lock = AppLock(defaults: UserDefaults(suiteName: "lock-off") ?? .standard, keychain: nil)
        lock.asked = true
        return lock
    }

    var isEnabled: Bool { usesBiometrics || hasPasscode }
    var needsSetup: Bool { !asked }

    // MARK: Lifecycle

    func launched() {
        isLocked = isEnabled
    }

    func movedToBackground() {
        backgroundedAt = now()
    }

    func cameToForeground() {
        defer { backgroundedAt = nil }
        guard isEnabled, !isLocked, let backgroundedAt else { return }
        if now().timeIntervalSince(backgroundedAt) >= TimeInterval(delay.rawValue) { isLocked = true }
    }

    func unlock() {
        isLocked = false
        failures = 0
        waitUntil = nil
        defaults.removeObject(forKey: Key.failures)
        defaults.removeObject(forKey: Key.waitUntil)
    }

    // MARK: Setup

    func useBiometrics(_ on: Bool) {
        usesBiometrics = on
        defaults.set(on, forKey: Key.biometrics)
        markAsked()
    }

    func setPasscode(_ digits: String) {
        guard Self.isValid(digits) else { return }
        let salt = Self.randomSalt()
        let record = Hashed(salt: salt, hash: Self.derive(digits, salt: salt))
        if let keychain { try? keychain.save(record, for: Key.passcode) } else { memoryPasscode = record }
        hasPasscode = true
        markAsked()
    }

    func removePasscode() {
        keychain?.delete(Key.passcode)
        memoryPasscode = nil
        hasPasscode = false
    }

    func skip() {
        markAsked()
    }

    func setDelay(_ delay: Delay) {
        self.delay = delay
        defaults.set(delay.rawValue, forKey: Key.delay)
    }

    /// Forgetting the passcode signs out; signing back in with the passkey loses nothing.
    func reset() {
        removePasscode()
        [Key.asked, Key.biometrics, Key.delay, Key.failures, Key.waitUntil].forEach(defaults.removeObject(forKey:))
        asked = false
        usesBiometrics = false
        delay = .oneMinute
        isLocked = false
        failures = 0
        waitUntil = nil
    }

    // MARK: Passcode

    func check(_ digits: String) -> Attempt {
        if let waitUntil, waitUntil > now() { return .wait(until: waitUntil) }
        guard let stored = storedPasscode, Self.derive(digits, salt: stored.salt) == stored.hash else {
            failures += 1
            defaults.set(failures, forKey: Key.failures)
            guard failures >= Self.triesBeforeWait else { return .wrong(left: Self.triesBeforeWait - failures) }
            let rounds = failures - Self.triesBeforeWait
            let until = now().addingTimeInterval(Self.firstWait * pow(2, Double(rounds)))
            waitUntil = until
            defaults.set(until, forKey: Key.waitUntil)
            return .wait(until: until)
        }
        unlock()
        return .unlocked
    }

    static func isValid(_ digits: String) -> Bool {
        digits.count == passcodeLength && digits.allSatisfy(\.isASCII) && digits.allSatisfy(\.isNumber)
    }

    private var storedPasscode: Hashed? {
        keychain?.load(Hashed.self, for: Key.passcode) ?? memoryPasscode
    }

    private func markAsked() {
        asked = true
        defaults.set(true, forKey: Key.asked)
    }

    private static func randomSalt() -> Data {
        Data((0..<16).map { _ in UInt8.random(in: .min ... .max) })
    }

    private static func derive(_ digits: String, salt: Data) -> Data {
        var key = Data(count: 32)
        let password = Array(digits.utf8)
        let saltBytes = Array(salt)
        _ = key.withUnsafeMutableBytes { out in
            CCKeyDerivationPBKDF(
                CCPBKDFAlgorithm(kCCPBKDF2), password.map { CChar(bitPattern: $0) }, password.count,
                saltBytes, saltBytes.count, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), 100_000,
                out.bindMemory(to: UInt8.self).baseAddress, 32
            )
        }
        return key
    }
}

/// Which biometric the device has, for the button titles, and the prompt that unlocks the app.
enum LockBiometry {
    static var name: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return "Face ID"
        }
    }

    static var symbol: String {
        switch name {
        case "Touch ID": "touchid"
        case "Optic ID": "opticid"
        default: "faceid"
        }
    }

    static var isAvailable: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
    }

    /// With no app passcode to fall back on, the device passcode is the fallback.
    static func unlock(allowDevicePasscode: Bool) async -> Bool {
        let context = LAContext()
        context.localizedFallbackTitle = allowDevicePasscode ? nil : ""
        let policy: LAPolicy = allowDevicePasscode ? .deviceOwnerAuthentication : .deviceOwnerAuthenticationWithBiometrics
        return (try? await context.evaluatePolicy(policy, localizedReason: "Unlock fliq")) ?? false
    }
}
