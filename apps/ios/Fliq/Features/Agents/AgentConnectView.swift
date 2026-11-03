import SwiftUI

struct AgentConnectView: View {
    let store: AgentStore
    @Environment(AppEnvironment.self) private var environment
    @State private var name = "Claude"
    @State private var publicKey = ""
    @State private var policy = AgentPolicy(dailyCap: 150_000, perPayout: 50_000)
    @State private var connecting = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                VStack(spacing: 10) {
                    AgentAvatar(name: name.isEmpty ? "?" : name)
                    TextField("Agent name", text: $name)
                        .font(.system(size: 16, weight: .semibold))
                        .multilineTextAlignment(.center)
                        .textInputAutocapitalization(.words)
                }
                .padding(.top, 22)

                SectionLabel(text: "Key").padding(.top, 20)
                VStack(spacing: 0) {
                    CardRow(isLast: true) {
                        Text("Public key").foregroundStyle(Theme.textSecondary)
                        TextField("ed25519:…", text: $publicKey)
                            .font(.system(size: 13, design: .monospaced))
                            .multilineTextAlignment(.trailing)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                }
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
                Text("Paste the public key your agent shows when it asks to connect.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
                    .padding(.top, 8)

                SectionLabel(text: "What it may do").padding(.top, 20)
                PolicyCard(policy: $policy)
            }
        }
        .scrollIndicators(.hidden)
        .safeAreaInset(edge: .bottom) {
            Button { connect() } label: {
                if connecting { ProgressView().tint(.black) } else { Text("Connect with Face ID") }
            }
            .buttonStyle(PrimaryButtonStyle(filled: true))
            .disabled(!canConnect || connecting)
            .padding(.bottom, 12)
        }
        .fliqScreen("Connect an agent")
    }

    private var canConnect: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && publicKey.hasPrefix("ed25519:") && publicKey.count > 12 && policy.isValid
    }

    private func connect() {
        Task {
            guard await environment.biometrics.approve("Let \(name) pay from your vault") else { return }
            connecting = true
            defer { connecting = false }
            if await store.connect(name: name, publicKey: publicKey, policy: policy) != nil {
                environment.router.path.removeLast()
            }
        }
    }
}
