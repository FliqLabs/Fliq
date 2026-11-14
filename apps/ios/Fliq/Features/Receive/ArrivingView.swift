import SwiftUI

struct ArrivingView: View {
    let flow: ReceiveFlow
    let onDone: () -> Void
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        if let deposit = flow.deposit {
            content(deposit)
                .task { await flow.track() }
        }
    }

    @State private var sentAt: Date?

    private var stage: DepositStatus.Stage { flow.status?.stage ?? .waiting }

    /// How far the timeline got. A deposit that is not coming stops where it was seen, with nothing spinning.
    private var reachedStage: DepositStatus.Stage {
        guard stage.isNotComing else { return stage }
        return flow.status?.seenAt == nil ? .waiting : .seen
    }

    private func content(_ deposit: DepositAddress) -> some View {
        VStack(spacing: 0) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                header(deposit, now: context.date)
            }
            .padding(.top, 36)

            VStack(alignment: .leading, spacing: 0) {
                step("Seen on \(deposit.source.chain)", detail: seenDetail(deposit), logo: seenLogo(deposit), reached: .seen, isLast: false)
                if !deposit.source.isDirect {
                    step("Moving to NEAR", detail: bridgeDetail(deposit), logo: "ChainNEAR", reached: .bridging, isLast: false)
                }
                step("In your vault", detail: vaultDetail, logo: "VaultMark", reached: .landed, isLast: true)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
            .padding(.top, 36)

            Spacer()

            Button("Back to vault", action: onDone)
                .buttonStyle(PrimaryButtonStyle())
                .padding(.bottom, 6)
        }
        .fliqScreen(stage.isNotComing ? DepositFailure.notReceived : "Arriving")
        .animation(.snappy, value: stage)
        .sensoryFeedback(.success, trigger: stage) { _, new in new == .landed }
        .navigationBarBackButtonHidden()
        .onAppear { if sentAt == nil { sentAt = .now } }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(action: onDone) { Icon("xmark") }
                    .accessibilityLabel("Close")
            }
        }
    }

    private func header(_ deposit: DepositAddress, now: Date) -> some View {
        let progress = stage.isNotComing ? 0 : progress(deposit, now: now)
        return VStack(spacing: 8) {
            ZStack {
                Circle().stroke(Color(hex: 0x262626), lineWidth: 2)
                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(stage == .landed ? Theme.confirmed : .white, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.linear(duration: 1), value: progress)
                SourceBadge(source: deposit.source, size: 34, ring: Color(hex: 0x0E0E0E))
            }
            .frame(width: 66, height: 66)
            .padding(3)
            .padding(.bottom, 8)
            if stage.isNotComing {
                Text(DepositFailure.notReceived)
                    .font(.system(size: 30, weight: .light))
                    .tracking(-0.6)
                    .frame(height: 64)
            } else if let landing = flow.landing {
                HeroAmount(symbol: "+$", value: landing.decimalString)
            } else {
                Text("Waiting for your \(deposit.source.token)")
                    .font(.system(size: 30, weight: .light))
                    .tracking(-0.6)
                    .frame(height: 64)
            }
            Text(caption(deposit, now: now))
                .font(.system(size: 15))
                .foregroundStyle(stage == .landed ? Theme.confirmed : Theme.textSecondary)
                .multilineTextAlignment(.center)
                .contentTransition(.numericText())
        }
    }

    private func secondsLeft(_ deposit: DepositAddress, now: Date) -> Int {
        let elapsed = now.timeIntervalSince(sentAt ?? now)
        return max(1, deposit.estimatedSeconds - Int(elapsed))
    }

    private func progress(_ deposit: DepositAddress, now: Date) -> CGFloat {
        if stage == .landed { return 1 }
        let elapsed = now.timeIntervalSince(sentAt ?? now)
        return min(0.95, max(0.04, elapsed / Double(max(1, deposit.estimatedSeconds))))
    }

    private func caption(_ deposit: DepositAddress, now: Date) -> String {
        if stage == .landed { return "in your vault" }
        if stage == .underpaid { return "\(DepositFailure.belowMinimum) \(DepositFailure.contactUs)" }
        if stage.isNotComing { return DepositFailure.contactUs }
        if stage == .waiting { return "We'll show it here the moment it arrives" }
        if stage == .seen || stage == .bridging { return "Received. Arriving in your vault" }
        let left = secondsLeft(deposit, now: now)
        if left >= 120 { return "about \(left / 60) minutes left" }
        return left == 1 ? "about a second left" : "about \(left) seconds left"
    }

    private func seenLogo(_ deposit: DepositAddress) -> String {
        deposit.source.group == .bitcoin ? "TokenBTC" : deposit.source.chainImage
    }

    private var vaultDetail: String {
        let now = environment.vault.balance
        if stage == .landed { return "balance is $\(Money.dollars(now))" }
        if stage.isNotComing { return "not received" }
        guard let landing = flow.landing else { return "your balance updates when it lands" }
        return "balance becomes $\(Money.dollars(TokenAmount(baseUnits: now.baseUnits + landing.baseUnits)))"
    }

    private func seenDetail(_ deposit: DepositAddress) -> String {
        guard let seen = flow.status?.seenAt, let received = flow.status?.received else { return "waiting" }
        return "\(seen.formatted(date: .omitted, time: .standard)) · \(received.decimalString) \(deposit.source.token)"
    }

    private func bridgeDetail(_ deposit: DepositAddress) -> String {
        guard let at = flow.status?.bridgingAt else { return "via NEAR Intents" }
        return "\(at.formatted(date: .omitted, time: .standard)) · via NEAR Intents · fee $\(deposit.fee.decimalString)"
    }

    private func step(_ title: String, detail: String, logo: String, reached: DepositStatus.Stage, isLast: Bool) -> some View {
        let done = reachedStage >= reached
        let active = !done && !stage.isNotComing && stage.rawValue + 1 == reached.rawValue
        let lit = done || active
        return HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 6) {
                StepIcon(logo: logo, state: done ? .done : active ? .active : .pending)
                if !isLast {
                    Rectangle()
                        .fill(done ? Color.white : Color(hex: 0x333333))
                        .frame(width: 2)
                        .frame(minHeight: 22, maxHeight: .infinity)
                }
            }
            .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 16, weight: .medium))
                    .foregroundStyle(lit ? Theme.textPrimary : Theme.textTertiary)
                Text(detail).font(.system(size: 13))
                    .foregroundStyle(lit ? Theme.textSecondary : Theme.textTertiary)
            }
            .padding(.top, 4)
            .padding(.bottom, isLast ? 0 : 20)
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// A timeline step's chain logo: ticked when done, circled by a spinner while it runs, faded until then.
private struct StepIcon: View {
    enum Phase { case done, active, pending }

    let logo: String
    let state: Phase
    @State private var spin = false

    var body: some View {
        Image(logo)
            .resizable()
            .scaledToFit()
            .frame(width: 28, height: 28)
            .background(Color(hex: 0x111111))
            .clipShape(Circle())
            .opacity(state == .pending ? 0.4 : 1)
            .overlay { ring }
            .overlay(alignment: .bottomTrailing) {
                if state == .done {
                    Icon("checkmark", size: 7)
                        .foregroundStyle(.white)
                        .frame(width: 13, height: 13)
                        .background(Theme.confirmed, in: Circle())
                        .padding(2)
                        .background(Theme.surface, in: Circle())
                        .offset(x: 5, y: 5)
                }
            }
            .frame(width: 28, height: 28)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var ring: some View {
        switch state {
        case .done:
            EmptyView()
        case .active:
            ZStack {
                Circle().stroke(Color(hex: 0x2C2C2C), lineWidth: 2)
                Circle()
                    .trim(from: 0, to: 0.32)
                    .stroke(.white, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    .rotationEffect(.degrees(spin ? 360 : 0))
                    .onAppear {
                        withAnimation(.linear(duration: 1.1).repeatForever(autoreverses: false)) { spin = true }
                    }
            }
            .frame(width: 34, height: 34)
        case .pending:
            Circle()
                .stroke(Theme.textTertiary, style: StrokeStyle(lineWidth: 2, dash: [3, 4]))
                .frame(width: 34, height: 34)
        }
    }
}
