import SwiftUI

struct AgentRevokeSheet: View {
    let store: AgentStore
    let agent: Agent
    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss
    @State private var revoking = false

    var body: some View {
        VStack(spacing: 0) {
            AgentAvatar(name: agent.name, size: 72, revoked: true)
                .padding(.top, 40)
            Text("Revoke \(agent.name)'s key?")
                .font(.system(size: 22, weight: .semibold))
                .padding(.top, 20)
            Text("It stops instantly, on chain.\nToday's \(Money.local(agent.usedToday, .ngn)) already paid stays paid.")
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
                .padding(.top, 8)

            Spacer(minLength: 24)

            Button { revoke() } label: {
                if revoking { ProgressView().tint(.black) } else { Text("Revoke with Face ID") }
            }
            .buttonStyle(PrimaryButtonStyle(filled: true))
            .disabled(revoking)
            Button("Keep") { dismiss() }
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .frame(height: 40)
                .padding(.top, 10)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
        .foregroundStyle(Theme.textPrimary)
    }

    private func revoke() {
        Task {
            guard await environment.biometrics.approve("Revoke \(agent.name)'s key") else { return }
            revoking = true
            defer { revoking = false }
            if await store.revoke(agent.id) { dismiss() }
        }
    }
}
