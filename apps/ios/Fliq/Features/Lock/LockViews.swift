import SwiftUI

/// Asked once after onboarding: lock fliq with Face ID, a passcode, or not at all.
struct SecureFliqView: View {
    let lock: AppLock
    @State private var settingPasscode = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Spacer()
                Icon(LockBiometry.symbol, size: 67)
                    .foregroundStyle(Theme.brand)
                    .padding(.bottom, 28)
                Text("Secure fliq")
                    .font(.system(size: 32, weight: .bold))
                    .tracking(-0.6)
                Text("Lock the app so only you can open it. Sending money always asks for \(LockBiometry.name) too.")
                    .font(.system(size: 16))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.top, 10)
                    .padding(.horizontal, 12)
                Spacer()
                VStack(spacing: 12) {
                    if LockBiometry.isAvailable {
                        Button {
                            Task { if await LockBiometry.unlock(allowDevicePasscode: false) { lock.useBiometrics(true) } }
                        } label: {
                            IconLabel("Use \(LockBiometry.name)", icon: LockBiometry.symbol)
                        }
                        .buttonStyle(PrimaryButtonStyle(filled: true))
                    }
                    Button(LockBiometry.isAvailable ? "Set a passcode instead" : "Set a passcode") { settingPasscode = true }
                        .buttonStyle(PrimaryButtonStyle(filled: !LockBiometry.isAvailable))
                    Button("Not now") { lock.skip() }
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.top, 6)
                }
                .padding(.bottom, 12)
            }
            .fliqScreen(ground: Theme.onboardingGround)
            .navigationDestination(isPresented: $settingPasscode) {
                NewPasscodeView { lock.setPasscode($0) }
            }
        }
    }
}

/// Six digits, typed twice. Hands back the passcode only when both match.
struct NewPasscodeView: View {
    let onSet: (String) -> Void
    @State private var first: String?
    @State private var digits = ""
    @State private var mismatch = false

    var body: some View {
        VStack(spacing: 0) {
            Text(first == nil ? "Choose a passcode" : "Enter it again")
                .font(.system(size: 26, weight: .bold))
                .padding(.top, 48)
            Text(mismatch ? "Those didn't match. Start again." : "Six digits to open fliq.")
                .font(.system(size: 15))
                .foregroundStyle(mismatch ? Theme.warning : Theme.textSecondary)
                .padding(.top, 8)
            PasscodeField(digits: $digits)
                .padding(.top, 40)
            Spacer()
        }
        .fliqScreen("Passcode", ground: Theme.onboardingGround)
        .onChange(of: digits) { _, typed in
            guard AppLock.isValid(typed) else { return }
            if let first {
                if first == typed { onSet(typed) } else { mismatch = true; self.first = nil }
            } else {
                first = typed
                mismatch = false
            }
            digits = ""
        }
    }
}

/// Covers the app until Face ID or the passcode opens it.
struct LockScreen: View {
    let lock: AppLock
    let onForgot: () -> Void
    @State private var digits = ""
    @State private var message: String?
    @State private var forgetting = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            Wordmark(size: 40)
            Text("fliq is locked")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .padding(.top, 14)
            if lock.hasPasscode {
                PasscodeField(digits: $digits, focusOnAppear: !lock.usesBiometrics)
                    .padding(.top, 40)
                    .disabled(waiting(at: .now))
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(status(at: context.date))
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.warning)
                        .frame(height: 20)
                }
                .padding(.top, 14)
            }
            Spacer()
            VStack(spacing: 12) {
                if lock.usesBiometrics {
                    Button { Task { await tryBiometrics() } } label: {
                        IconLabel("Unlock with \(LockBiometry.name)", icon: LockBiometry.symbol)
                    }
                    .buttonStyle(PrimaryButtonStyle(filled: true))
                }
                if lock.hasPasscode {
                    Button("Forgot passcode?") { forgetting = true }
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .padding(.bottom, 12)
        }
        .fliqScreen(ground: Theme.onboardingGround)
        .task { if lock.usesBiometrics { await tryBiometrics() } }
        .onChange(of: digits) { _, typed in
            guard AppLock.isValid(typed) else { return }
            digits = ""
            switch lock.check(typed) {
            case .unlocked: message = nil
            case .wrong(let left): message = "Wrong passcode. \(left) \(left == 1 ? "try" : "tries") left."
            case .wait: message = nil
            }
        }
        .confirmationDialog("Sign out to reset your passcode?", isPresented: $forgetting, titleVisibility: .visible) {
            Button("Sign out", role: .destructive, action: onForgot)
        } message: {
            Text("Sign back in with your passkey. Your money and your name stay yours.")
        }
    }

    private func tryBiometrics() async {
        if await LockBiometry.unlock(allowDevicePasscode: !lock.hasPasscode) { lock.unlock() }
    }

    private func waiting(at date: Date) -> Bool {
        (lock.waitUntil ?? .distantPast) > date
    }

    private func status(at date: Date) -> String {
        guard let until = lock.waitUntil, until > date else { return message ?? "" }
        return "Too many tries. Try again in \(Int(until.timeIntervalSince(date).rounded(.up)))s."
    }
}

/// Six dots over a hidden number-pad field.
struct PasscodeField: View {
    @Binding var digits: String
    var focusOnAppear = true
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 18) {
            ForEach(0..<AppLock.passcodeLength, id: \.self) { index in
                Circle()
                    .fill(index < digits.count ? Theme.textPrimary : Color.clear)
                    .overlay(Circle().strokeBorder(Theme.textSecondary, lineWidth: 1.5))
                    .frame(width: 16, height: 16)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44)
        .contentShape(Rectangle())
        .onTapGesture { focused = true }
        .background {
            TextField("", text: $digits)
                .keyboardType(.numberPad)
                .focused($focused)
                .opacity(0.01)
                .accessibilityLabel("Passcode")
                .onChange(of: digits) { _, typed in
                    let cleaned = String(typed.filter(\.isNumber).prefix(AppLock.passcodeLength))
                    if cleaned != typed { digits = cleaned }
                }
        }
        .onAppear { if focusOnAppear { focused = true } }
    }
}

/// What the app switcher shows while fliq has something to hide.
struct PrivacyCover: View {
    var body: some View {
        ZStack {
            Theme.onboardingGround.ignoresSafeArea()
            Wordmark(size: 40)
        }
    }
}
