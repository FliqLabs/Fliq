import SwiftUI

struct AgentLimitsSheet: View {
    let store: AgentStore
    let agent: Agent
    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss
    @State private var policy: AgentPolicy
    @State private var saving = false

    init(store: AgentStore, agent: Agent) {
        self.store = store
        self.agent = agent
        _policy = State(initialValue: agent.policy)
    }

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: "\(agent.name)'s limits") { dismiss() }

            PolicyCard(policy: $policy)
                .padding(.top, 20)

            if policy.perPayout > policy.dailyCap {
                Text("Per payout can't be more than the daily cap.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.warning)
                    .padding(.top, 10)
            }

            HStack(spacing: 10) {
                Icon("checkmark.shield", size: 18).foregroundStyle(Theme.textSecondary)
                Text("Written to \(store.vaultAccount). Takes effect on the next payout.")
            }
            .font(.system(size: 13))
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
            .padding(.top, 12)

            Spacer(minLength: 20)

            Button { save() } label: {
                if saving { ProgressView().tint(.black) } else { Text("Save with Face ID") }
            }
            .buttonStyle(PrimaryButtonStyle(filled: true))
            .disabled(!policy.isValid || policy == agent.policy || saving)
            Button("Cancel") { dismiss() }
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .frame(height: 40)
                .padding(.top, 10)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
    }

    private func save() {
        Task {
            guard await environment.biometrics.approve("Change \(agent.name)'s limits") else { return }
            saving = true
            defer { saving = false }
            if await store.update(agent.id, policy: policy) { dismiss() }
        }
    }
}

/// Daily cap, per payout, currencies and the saved-accounts switch, as on Connect and Limits.
struct PolicyCard: View {
    @Binding var policy: AgentPolicy

    var body: some View {
        VStack(spacing: 0) {
            LimitStepper(label: "Per day", value: $policy.dailyCap)
            LimitStepper(label: "Per payment", value: $policy.perPayout)
            CardRow {
                Text("Pays to").foregroundStyle(Theme.textSecondary)
                Spacer()
                CurrencyChips(selection: $policy.currencies)
            }
            CardRow(isLast: true) {
                Toggle("Only my saved accounts", isOn: $policy.savedAccountsOnly)
                    .foregroundStyle(Theme.textSecondary)
                    .tint(Theme.confirmed)
            }
        }
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
    }
}
