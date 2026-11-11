import SwiftUI
import UIKit

struct AgentConnectView: View {
    @State private var flow: AgentConnectFlow
    @Environment(AppEnvironment.self) private var environment

    init(store: AgentStore, rpcURL: String = AgentSetup.bundledRPC) {
        _flow = State(initialValue: AgentConnectFlow(store: store, rpcURL: rpcURL))
    }

    var body: some View {
        Group {
            switch flow.step {
            case .chooseApp: AppChoice(flow: flow)
            case .limits: LimitsStep(flow: flow, onConnect: connect)
            case .connecting: ConnectingStep(name: flow.name)
            case .done: DoneStep(flow: flow, onClose: close)
            case .failed(let message): FailedStep(message: message, onRetry: flow.retry)
            }
        }
        .animation(.snappy(duration: 0.25), value: flow.step)
        .fliqScreen(flow.step == .chooseApp ? "Connect an agent" : flow.step == .done ? "Connected" : flow.name)
        .navigationBarBackButtonHidden(flow.step == .connecting || flow.step == .done)
        .onDisappear { flow.finish() }
    }

    private func connect() {
        Task {
            guard await environment.biometrics.approve("Let \(flow.name) pay from your vault") else { return }
            await flow.connect()
        }
    }

    private func close() {
        flow.finish()
        environment.router.path.removeLast()
    }
}

private struct AppChoice: View {
    let flow: AgentConnectFlow

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Which app is your agent in?")
                    .font(.system(size: 26, weight: .semibold))
                    .padding(.top, 20)
                Text("fliq makes its key and sets its limits. You paste one line into the app.")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.top, 6)

                VStack(spacing: 0) {
                    ForEach(AgentApp.allCases) { app in
                        Button { flow.choose(app) } label: {
                            CardRow(isLast: app == .other) {
                                AgentLogo(app: app, size: 40)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(app.title).font(.system(size: 16, weight: .medium))
                                    Text(app.detail).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                                }
                                Spacer()
                                Icon("chevron.right", size: 16)
                                    .foregroundStyle(Theme.textTertiary)
                            }
                            .contentShape(Rectangle())
                        }
                        .foregroundStyle(Theme.textPrimary)
                        .accessibilityIdentifier("agent-app-\(app.rawValue)")
                    }
                }
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
                .padding(.top, 22)

                Button("My agent already has a key") { flow.useExistingKey() }
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 18)
            }
        }
        .scrollIndicators(.hidden)
    }
}

private struct LimitsStep: View {
    @Bindable var flow: AgentConnectFlow
    let onConnect: () -> Void
    @State private var showBlocker = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                VStack(spacing: 10) {
                    AgentLogo(app: flow.app, size: 64)
                    TextField("Agent name", text: $flow.name)
                        .font(.system(size: 18, weight: .semibold))
                        .multilineTextAlignment(.center)
                        .textInputAutocapitalization(.words)
                        .accessibilityLabel("Agent name")
                }
                .padding(.top, 18)

                if flow.usesExistingKey {
                    SectionLabel(text: "Its public key").padding(.top, 22)
                    TextField("ed25519:…", text: $flow.existingKey, axis: .vertical)
                        .font(.system(size: 14, design: .monospaced))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(14)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
                    Text("The public half of the key your agent made. It starts with ed25519:")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textTertiary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 8)
                }

                SectionLabel(text: "What it may do").padding(.top, 22)
                PolicyCard(policy: $flow.policy)

                Text(flow.summary)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(Theme.surface.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
                    .padding(.top, 12)
            }
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 10) {
                if showBlocker, let blocker = flow.blocker {
                    Text(blocker).font(.system(size: 13)).foregroundStyle(Theme.warning)
                }
                Button {
                    if flow.blocker == nil { onConnect() } else { withAnimation { showBlocker = true } }
                } label: {
                    IconLabel("Connect with Face ID", icon: "faceid")
                }
                .buttonStyle(PrimaryButtonStyle(filled: true))
            }
            .padding(.bottom, 12)
            .background(Theme.ground)
        }
        .onChange(of: flow.blocker) { _, blocker in if blocker == nil { showBlocker = false } }
    }
}

private struct ConnectingStep: View {
    let name: String

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            ProgressView().controlSize(.large)
            Text("Connecting \(name)").font(.system(size: 20, weight: .semibold))
            Text("Making its key, then setting its limits on your vault. This takes a few seconds.")
                .font(.system(size: 15))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
            Spacer()
            Spacer()
        }
        .padding(.horizontal, 12)
    }
}

private struct DoneStep: View {
    let flow: AgentConnectFlow
    let onClose: () -> Void
    @State private var copied = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 14) {
                    AgentLogo(app: flow.app, size: 52)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(flow.isActive ? "\(flow.name) is connected" : "\(flow.name) is almost ready")
                            .font(.system(size: 20, weight: .semibold))
                        Text(flow.isActive ? "Its limits are live on your vault." : "Your vault is saving its limits. It turns active in a moment.")
                            .font(.system(size: 14))
                            .foregroundStyle(flow.isActive ? Theme.confirmed : Theme.textSecondary)
                    }
                }
                .padding(.top, 18)

                Text(flow.summary)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.top, 14)

                if let setup = flow.setup {
                    SectionLabel(text: "Add fliq to \(flow.app.agentName)").padding(.top, 26)
                    Text(setup.destination).font(.system(size: 14)).foregroundStyle(Theme.textSecondary).padding(.bottom, 8)
                    ScrollView(.horizontal, showsIndicators: false) {
                        Text(setup.snippet)
                            .font(.system(size: 12, design: .monospaced))
                            .textSelection(.enabled)
                            .padding(14)
                    }
                    .background(Color(hex: 0x0E0E0E), in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.white.opacity(0.08)))

                    Button {
                        UIPasteboard.general.setItems([[UIPasteboard.typeAutomatic: setup.snippet]],
                                                      options: [.expirationDate: Date.now.addingTimeInterval(300)])
                        withAnimation { copied = true }
                    } label: {
                        IconLabel(copied ? "Copied" : "Copy setup", icon: copied ? "checkmark" : "doc.on.doc")
                    }
                    .buttonStyle(CompactButtonStyle(prominent: true))
                    .padding(.top, 10)

                    notice(
                        icon: "exclamationmark.shield",
                        text: "Shown once. Anyone with this can spend up to your limits. Revoke anytime in Agents.",
                        tint: Theme.warning
                    )
                    .padding(.top, 14)
                    notice(
                        icon: "key",
                        text: "Replace \(AgentSetup.apiKeyPlaceholder) with an API key from fliq.cash/dashboard/api-keys.",
                        tint: Theme.textSecondary
                    )
                    .padding(.top, 8)
                    notice(
                        icon: "shippingbox",
                        text: "The fliq connector (@fliq/mcp) is in preview and not on npm yet. Keep this setup; it works once it's published.",
                        tint: Theme.textSecondary
                    )
                    .padding(.top, 8)
                } else {
                    Text("Your agent signs with its own key and can now pay within these limits.")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.top, 14)
                }
            }
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .safeAreaInset(edge: .bottom) {
            Button("Done", action: onClose)
                .buttonStyle(PrimaryButtonStyle(filled: true))
                .padding(.bottom, 12)
                .background(Theme.ground)
        }
    }

    private func notice(icon: String, text: String, tint: Color) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Icon(icon).foregroundStyle(tint)
            Text(text).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct FailedStep: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Spacer()
            Icon("exclamationmark.circle", size: 41).foregroundStyle(Theme.warning)
            Text(message)
                .font(.system(size: 16))
                .multilineTextAlignment(.center)
            Spacer()
            Button("Try again", action: onRetry).buttonStyle(PrimaryButtonStyle(filled: true)).padding(.bottom, 12)
        }
    }
}
