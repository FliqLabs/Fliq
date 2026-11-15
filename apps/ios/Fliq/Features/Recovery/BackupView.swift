import SwiftUI

/// Settings > Security > Account backup. Turns on the backup that lets a new iPhone get back into the account.
struct BackupView: View {
    @Environment(AppEnvironment.self) private var environment
    @State private var state: RecoveryState?
    @State private var loaded = false
    @State private var working = false
    @State private var message: String?
    @State private var confirmingOff = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                VStack(spacing: 12) {
                    Icon(isOn ? "checkmark.shield" : "exclamationmark.shield", size: 44)
                        .foregroundStyle(isOn ? Theme.confirmed : Theme.warning)
                    Text(title).font(.system(size: 22, weight: .medium))
                    Text(detail)
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 12)
                }
                .padding(.top, 32)

                SectionLabel(text: "How it works").padding(.top, 28)
                VStack(spacing: 0) {
                    fact("iphone", "A backup key is saved in your iCloud Keychain, next to your passwords.")
                    fact("arrow.counterclockwise", "On a new iPhone with the same Apple ID, sign in and fliq adds that iPhone to your account.")
                    fact("lock", "Keep your Apple ID safe. Someone who gets into your iCloud Keychain could reach your money.", isLast: true)
                }
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))

                if let message {
                    Text(message)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.warning)
                        .multilineTextAlignment(.center)
                        .padding(.top, 20)
                }
            }
            .foregroundStyle(Theme.textPrimary)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .safeAreaInset(edge: .bottom) {
            if state == .notBackedUp {
                Button {
                    Task { await backUp() }
                } label: {
                    if working { ProgressView() } else { IconLabel("Back up with Face ID", icon: "faceid") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(working)
                .padding(.bottom, 12)
            }
        }
        .fliqScreen("Account backup")
        .task { await load() }
        .toolbar {
            if isOn {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Turn off") { confirmingOff = true }.foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .confirmationDialog("Turn off account backup?", isPresented: $confirmingOff, titleVisibility: .visible) {
            Button("Turn off backup", role: .destructive) { Task { await turnOff() } }
        } message: {
            Text("Only this iPhone will be able to move your money. If you lose it, nobody can reach your balance.")
        }
    }

    private func turnOff() async {
        guard let backupKey = await environment.recovery.keys()?.first(where: { $0.holder == .backup }) else { return }
        working = true
        defer { working = false }
        do {
            try await environment.recovery.remove(backupKey)
            message = nil
            state = .notBackedUp
        } catch let error as KeychainError where error.status == errSecUserCanceled {
            return
        } catch {
            message = "Backup is still on. Nothing changed. Try again."
        }
    }

    private var isOn: Bool { state == .backedUp }

    private var title: String {
        switch state {
        case .backedUp: "Your account is backed up"
        case .notBackedUp: "Not backed up yet"
        case .canRestore, .cannotSign: "This iPhone isn't set up"
        case nil: loaded ? "We couldn't check" : "Checking"
        }
    }

    private var detail: String {
        switch state {
        case .backedUp: "If you lose this iPhone, sign in on a new one with the same Apple ID and your money is there."
        case .notBackedUp: "Right now only this iPhone can move your money. If it is lost or reset, nobody can reach your balance, not even fliq."
        case .canRestore, .cannotSign: "Add this iPhone to your account from the Home screen first."
        case nil: loaded ? "Check your connection and pull down to try again." : " "
        }
    }

    private func fact(_ symbol: String, _ text: String, isLast: Bool = false) -> some View {
        CardRow(isLast: isLast) {
            Icon(symbol, size: 20).foregroundStyle(Theme.textSecondary)
            Text(text)
                .font(.system(size: 14))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
    }

    private func load() async {
        state = await environment.recovery.state()
        loaded = true
    }

    private func backUp() async {
        working = true
        defer { working = false }
        do {
            try await environment.recovery.backUp()
            message = nil
            // The chain may need a moment before it shows the new key.
            state = .backedUp
        } catch let error as KeychainError where error.status == errSecUserCanceled {
            return
        } catch TransferError.stillPending {
            message = "Still going through. Check back here in a minute."
        } catch {
            message = "The backup didn't go through. Nothing changed. Try again."
        }
    }
}

/// Shown on a new iPhone that is signed in but cannot move money yet.
struct RestoreSheet: View {
    let state: RecoveryState
    let onDone: () -> Void
    @Environment(AppEnvironment.self) private var environment
    @State private var working = false
    @State private var message: String?

    var body: some View {
        VStack(spacing: 0) {
            Icon(canRestore ? "iphone" : "exclamationmark.shield", size: 44)
                .foregroundStyle(canRestore ? Theme.textPrimary : Theme.warning)
                .padding(.top, 36)
            Text(canRestore ? "Add this iPhone to your account" : "This iPhone can't move your money")
                .font(.system(size: 22, weight: .medium))
                .multilineTextAlignment(.center)
                .padding(.top, 16)
            Text(detail)
                .font(.system(size: 15))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.top, 10)
            if let message {
                Text(message)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.warning)
                    .multilineTextAlignment(.center)
                    .padding(.top, 14)
            }
            Spacer(minLength: 24)
            if canRestore {
                Button {
                    Task { await restore() }
                } label: {
                    if working { ProgressView() } else { IconLabel("Add this iPhone with Face ID", icon: "faceid") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(working)
            }
            Button(canRestore ? "Not now" : "OK", action: onDone)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .frame(height: 48)
        }
        .foregroundStyle(Theme.textPrimary)
        .padding(.horizontal, 24)
        .padding(.bottom, 8)
    }

    private var canRestore: Bool { state == .canRestore }

    private var detail: String {
        canRestore
            ? "You're signed in and your balance is safe. Your backup is on this iPhone, so one more step lets it send and cash out."
            : "You're signed in and your balance is safe, but this iPhone has no backup to unlock it with. Open fliq on the iPhone you set it up on and turn on Account backup in Settings."
    }

    private func restore() async {
        working = true
        defer { working = false }
        do {
            try await environment.recovery.restore()
            onDone()
        } catch RecoveryError.notApproved {
            return
        } catch TransferError.stillPending {
            message = "Still going through. Try sending in a minute."
        } catch {
            message = "That didn't go through. Nothing changed. Try again."
        }
    }
}
