import Foundation
import LocalAuthentication
import Observation
import Security
import SwiftUI

/// Why this iPhone could not sign a send, in words the user can act on. Nil for anything else, such as a cancelled
/// Face ID or a network error, which each flow explains itself.
enum SignFailure: Equatable {
    /// This iPhone's key is not on the account, or its private half is not in this iPhone's Keychain.
    case notAdded
    /// The Keychain only releases the key behind the device passcode, and none is set.
    case noPasscode
    /// The app has no account or vault to sign for.
    case signInAgain

    static let notAddedMessage = "This iPhone can't send yet. Add it in Settings > Security > Account backup with your passkey."

    var message: String {
        switch self {
        case .notAdded: Self.notAddedMessage
        case .noPasscode: "Turn on a passcode in Settings to send."
        case .signInAgain: "Sign in again to send."
        }
    }

    init?(_ error: Error, passcodeSet: () -> Bool = DevicePasscode.isSet) {
        switch error {
        case let error as NEARRPCError where error.isUnknownAccessKey:
            self = .notAdded
        case TransferError.notSetUp:
            self = .signInAgain
        case let error as KeychainError:
            if error.status == errSecUserCanceled { return nil }
            if error.status == errSecItemNotFound { self = .notAdded; return }
            guard !passcodeSet() else { return nil }
            self = .noPasscode
        default:
            return nil
        }
    }

    /// Face ID or the passcode was cancelled: nothing to say.
    static func isCancel(_ error: Error) -> Bool {
        guard let error = error as? KeychainError else { return false }
        return error.status == errSecUserCanceled || error.status == errSecAuthFailed
    }
}

enum DevicePasscode {
    /// False only when the system says outright that no passcode is set.
    static func isSet() -> Bool {
        var error: NSError?
        if LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) { return true }
        return error?.code != LAError.passcodeNotSet.rawValue
    }
}

/// Whether this iPhone can sign for the account, read from the chain each time a money screen opens. When it cannot,
/// the screen offers the restore sheet instead of a send that would fail.
@MainActor
@Observable
final class SigningAccess {
    /// Set while this iPhone's key is not on the account: which restore sheet to open.
    private(set) var restoreState: RecoveryState?

    private let recovery: (any AccountRecovering)?

    init(recovery: (any AccountRecovering)?) {
        self.recovery = recovery
    }

    var isBlocked: Bool { restoreState != nil }

    /// Reads the chain again. An unreadable chain leaves things as they were, so the app never guesses.
    func check() async {
        guard let state = await readState() else { return }
        restoreState = state == .canRestore || state == .cannotSign ? state : nil
    }

    /// A send just failed because this iPhone is not on the account. The backup opens the sheet that uses it,
    /// anything else the passkey one.
    func notAdded() async {
        restoreState = await readState() == .canRestore ? .canRestore : .cannotSign
    }

    /// One retry: `state()` is nil when an RPC call fails, and one failed call should not hide the restore sheet.
    private func readState() async -> RecoveryState? {
        guard let recovery else { return nil }
        if let state = await recovery.state() { return state }
        return await recovery.state()
    }
}

/// The "can't send yet" line with a button that opens the restore sheet.
struct NotAddedPrompt: View {
    let signing: SigningAccess
    @State private var restoring: RecoveryState?

    var body: some View {
        VStack(spacing: 10) {
            Text(SignFailure.notAddedMessage)
                .font(.system(size: 13))
                .foregroundStyle(Theme.warning)
                .multilineTextAlignment(.center)
            Button { restoring = signing.restoreState } label: {
                IconLabel("Add this iPhone", icon: "iphone")
                    .font(.system(size: 15, weight: .medium))
                    .padding(.horizontal, 16)
                    .frame(height: 40)
                    .fliqGlass(Capsule(), interactive: true)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.textPrimary)
        }
        .padding(.bottom, 8)
        .sheet(item: $restoring) { state in
            RestoreSheet(state: state) {
                restoring = nil
                Task { await signing.check() }
            }
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
            .presentationCornerRadius(32)
            .presentationBackground(Color(hex: 0x161616))
        }
    }
}
