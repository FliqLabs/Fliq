import SwiftUI

/// The most that can leave the account in a day, chosen by the user. Lowering is instant; raising waits a day.
struct DailyLimitView: View {
    @State private var model: DailyLimitModel
    @State private var editing = false
    @State private var confirmingRemoval = false

    init(environment: AppEnvironment) {
        _model = State(initialValue: DailyLimitModel(api: environment.limits, biometrics: environment.biometrics))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                if let limits = model.limits {
                    summary(limits).padding(.top, 28)
                    if let pending = limits.pending { pendingCard(pending).padding(.top, 24) }
                    rules.padding(.top, 24)
                } else if model.message == nil {
                    ProgressView().padding(.top, 80)
                }
                if let message = model.message {
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
        .refreshable { await model.load() }
        .safeAreaInset(edge: .bottom) { actions }
        .fliqScreen("Daily limit")
        .task { await model.load() }
        .sheet(isPresented: $editing) {
            NavigationStack { DailyLimitEditor(model: model) { editing = false } }
                .presentationBackground(Color(hex: 0x161616))
        }
        .confirmationDialog("Remove your daily limit?", isPresented: $confirmingRemoval, titleVisibility: .visible) {
            Button("Remove limit", role: .destructive) { Task { _ = await model.remove() } }
        } message: {
            Text("It stays in place for 24 hours, then there is no limit. You can cancel any time before that.")
        }
    }

    @ViewBuilder
    private func summary(_ limits: Limits) -> some View {
        if let limit = limits.limitAmount {
            VStack(spacing: 10) {
                Text("Most that can leave in a day")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                HeroAmount(symbol: "$", value: Money.dollars(limit))
                ProgressView(value: limits.usedFraction)
                    .tint(limits.usedFraction >= 1 ? Theme.warning : Theme.confirmed)
                    .frame(maxWidth: 220)
                    .padding(.top, 6)
                Text("$\(Money.dollars(limits.remainingAmount ?? .zero)) left for the next 24 hours")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
            }
        } else {
            VStack(spacing: 12) {
                Icon("checkmark.shield", size: 40).foregroundStyle(Theme.textSecondary)
                Text("No daily limit")
                    .font(.system(size: 22, weight: .medium))
                Text("Set the most that can leave your account in a day. If your phone is ever stolen, that is the most anyone could take.")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 12)
            }
        }
    }

    private func pendingCard(_ pending: Limits.Pending) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Icon("clock", size: 22).foregroundStyle(Theme.warning)
                VStack(alignment: .leading, spacing: 3) {
                    Text(Self.pendingTitle(pending)).font(.system(size: 15, weight: .medium))
                    Text("On \(pending.effectiveAt.formatted(date: .abbreviated, time: .shortened)). Until then your limit stays as it is.")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 0)
            }
            Button("Cancel this change") { Task { _ = await model.cancelPending() } }
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Theme.danger)
                .disabled(model.isWorking)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
    }

    static func pendingTitle(_ pending: Limits.Pending) -> String {
        guard let amount = pending.dailyLimit.flatMap(TokenAmount.init(decimalString:)) else { return "Your limit is being removed" }
        return "Going up to $\(Money.dollars(amount))"
    }

    private var rules: some View {
        VStack(spacing: 0) {
            SectionLabel(text: "How it works")
            VStack(spacing: 0) {
                rule("arrow.up.arrow.down", "Covers cash-outs, payments to people and sends to other wallets.")
                rule("checkmark.shield", "Lowering your limit is instant.")
                rule("clock", "Raising it takes 24 hours, and we tell you when it is asked for.", isLast: true)
            }
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
        }
    }

    private func rule(_ symbol: String, _ text: String, isLast: Bool = false) -> some View {
        CardRow(isLast: isLast) {
            Icon(symbol, size: 20).foregroundStyle(Theme.textSecondary)
            Text(text)
                .font(.system(size: 14))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private var actions: some View {
        if let limits = model.limits {
            VStack(spacing: 4) {
                Button(limits.dailyLimit == nil ? "Set a limit" : "Change limit") {
                    model.startEditing()
                    editing = true
                }
                .buttonStyle(PrimaryButtonStyle())
                if limits.dailyLimit != nil, limits.pending?.dailyLimit != nil || limits.pending == nil {
                    Button("Remove limit") { confirmingRemoval = true }
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(height: 40)
                }
            }
            .disabled(model.isWorking)
            .padding(.bottom, 12)
        }
    }
}

private struct DailyLimitEditor: View {
    let model: DailyLimitModel
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 10) {
                Text("A day")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                HeroAmount(symbol: "$", value: Money.typed(model.amountText))
                Text(note)
                    .font(.system(size: 14))
                    .foregroundStyle(model.typedIsRaise ? Theme.warning : Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .frame(minHeight: 36)
            }
            Spacer()
            AmountKeypad(text: model.amountText, onType: model.enterAmount)
                .padding(.bottom, 12)
            if let message = model.message {
                Text(message)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.warning)
                    .multilineTextAlignment(.center)
                    .padding(.bottom, 8)
            }
            Button {
                Task { if await model.save() { onDone() } }
            } label: {
                if model.isWorking { ProgressView() } else { IconLabel("Save with Face ID", icon: "faceid") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!model.canSave)
            .padding(.bottom, 12)
        }
        .fliqScreen("Daily limit")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onDone).foregroundStyle(Theme.textPrimary) }
        }
    }

    private var note: String {
        guard model.typed != nil else { return "The most that can leave your account in a day." }
        guard model.typedIsRaise, let current = model.limits?.limitAmount else { return "Applies as soon as you save." }
        return "Takes effect in 24 hours. Your limit stays $\(Money.dollars(current)) until then."
    }
}

#Preview {
    NavigationStack { DailyLimitView(environment: .preview) }
        .environment(AppEnvironment.preview)
}
