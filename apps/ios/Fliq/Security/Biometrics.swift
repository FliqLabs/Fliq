import LocalAuthentication

protocol Biometrics: Sendable {
    func approve(_ reason: String) async -> Bool
}

/// Face ID, falling back to the device passcode. Nothing is sent without one of them.
struct DeviceBiometrics: Biometrics {
    func approve(_ reason: String) async -> Bool {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            #if targetEnvironment(simulator)
            return true
            #else
            return false
            #endif
        }
        return (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) ?? false
    }
}

struct AlwaysApprove: Biometrics {
    func approve(_ reason: String) async -> Bool { true }
}
