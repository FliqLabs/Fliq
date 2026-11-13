import SwiftUI
import UIKit

struct SecurityView: View {
    @Environment(AppEnvironment.self) private var environment
    @State private var passkeys: [Passkey]?
    @State private var devices: [DeviceSession]?
    @State private var signingOut: DeviceSession?
    @State private var settingPasscode = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                SectionLabel(text: "Passkeys").padding(.top, 20)
                card {
                    if let passkeys, !passkeys.isEmpty {
                        ForEach(Array(passkeys.enumerated()), id: \.element.id) { index, passkey in
                            CardRow(isLast: index == passkeys.count - 1) {
                                Icon("person.badge.key", size: 22)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(passkey.transports.contains("hybrid") ? "iCloud Keychain passkey" : "Passkey on this device")
                                    Text(passkeyDetail(passkey)).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                                }
                                Spacer()
                                Pill(text: "Active")
                            }
                        }
                    } else {
                        placeholder(passkeys == nil ? "Loading" : "No passkey yet. You signed in with email.")
                    }
                }

                SectionLabel(text: "App lock").padding(.top, 24)
                appLock

                SectionLabel(text: "Sending").padding(.top, 24)
                card {
                    InfoRow(symbol: nil, title: "Face ID to send", value: "Always on")
                    InfoRow(symbol: nil, title: "Face ID for agents' limits", value: "Always on", isLast: true)
                }
                Text("Nothing leaves your vault, and no agent's limits change, without Face ID or your passcode.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
                    .padding(.top, 8)

                SectionLabel(text: "Devices and sessions").padding(.top, 24)
                card {
                    if let devices, !devices.isEmpty {
                        ForEach(Array(devices.enumerated()), id: \.element.id) { index, device in
                            CardRow(isLast: index == devices.count - 1) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(device.device)
                                    Text(device.current ? "This device · active now" : "Last active \(device.lastActiveAt.formatted(.relative(presentation: .named)))")
                                        .font(.system(size: 13))
                                        .foregroundStyle(Theme.textSecondary)
                                }
                                Spacer()
                                if device.current {
                                    Circle().fill(Theme.confirmed).frame(width: 6, height: 6)
                                } else {
                                    Button("Sign out") { signingOut = device }
                                        .font(.system(size: 13, weight: .medium))
                                        .foregroundStyle(Theme.danger)
                                }
                            }
                        }
                    } else {
                        placeholder(devices == nil ? "Loading" : "Only this iPhone")
                    }
                }
            }
            .foregroundStyle(Theme.textPrimary)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .fliqScreen("Security")
        .task { await load() }
        .sheet(isPresented: $settingPasscode) {
            NavigationStack {
                NewPasscodeView { digits in
                    environment.lock.setPasscode(digits)
                    settingPasscode = false
                }
            }
            .presentationBackground(Color(hex: 0x161616))
        }
        .confirmationDialog(
            "Sign out \(signingOut?.device ?? "this device")?",
            isPresented: Binding(get: { signingOut != nil }, set: { if !$0 { signingOut = nil } }),
            titleVisibility: .visible
        ) {
            Button("Sign out", role: .destructive) {
                guard let device = signingOut else { return }
                Task {
                    try? await environment.api.revokeSession(id: device.sessionId)
                    await load()
                }
            }
        }
    }

    private var appLock: some View {
        let lock = environment.lock
        return card {
            CardRow {
                Icon(LockBiometry.symbol, size: 22)
                Toggle("Lock with \(LockBiometry.name)", isOn: Binding(get: { lock.usesBiometrics }, set: { on in
                    if !on { return lock.useBiometrics(false) }
                    Task { if await LockBiometry.unlock(allowDevicePasscode: false) { lock.useBiometrics(true) } }
                }))
                .tint(Theme.confirmed)
            }
            CardRow {
                Icon("lock", size: 22)
                Text("Passcode")
                Spacer()
                if lock.hasPasscode {
                    Button("Change") { settingPasscode = true }.foregroundStyle(Theme.textPrimary)
                    Button("Remove") { lock.removePasscode() }.foregroundStyle(Theme.danger)
                } else {
                    Button("Set") { settingPasscode = true }.foregroundStyle(Theme.textPrimary)
                }
            }
            .font(.system(size: 15, weight: .medium))
            CardRow(isLast: true) {
                Icon("timer", size: 22)
                Text("Lock")
                Spacer()
                Picker("Lock", selection: Binding(get: { lock.delay }, set: { lock.setDelay($0) })) {
                    ForEach(AppLock.Delay.allCases) { Text($0.title).tag($0) }
                }
                .labelsHidden()
                .tint(Theme.textSecondary)
                .disabled(!lock.isEnabled)
            }
        }
    }

    private func load() async {
        async let keys = try? environment.api.passkeys().items
        async let sessions = try? environment.api.deviceSessions().items
        passkeys = await keys ?? []
        devices = await sessions ?? []
    }

    private func passkeyDetail(_ passkey: Passkey) -> String {
        let made = "Made \(passkey.createdAt.formatted(date: .abbreviated, time: .omitted))"
        guard let used = passkey.lastUsedAt else { return made }
        return made + " · used \(used.formatted(.relative(presentation: .named)))"
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) { content() }
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
    }

    private func placeholder(_ text: String) -> some View {
        CardRow(isLast: true) {
            Text(text).foregroundStyle(Theme.textSecondary)
            Spacer()
        }
    }
}

struct Pill: View {
    let text: String
    var color: Color = Theme.confirmed
    var fill: Color = Color(hex: 0x0F2E19)

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .frame(height: 26)
            .background(fill, in: Capsule())
    }
}
