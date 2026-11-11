import SwiftUI
import UIKit

struct BankDepositView: View {
    @Bindable var flow: BankDepositFlow
    let onDone: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Add money · Nigeria")
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
            Text("Add money by bank transfer")
                .font(.system(size: 28, weight: .semibold))
                .tracking(-0.5)
                .padding(.top, 4)
            if flow.step != .cancelled && flow.step != .signIn {
                StepBar(reached: reached).padding(.top, 18)
            }
            content.padding(.top, 18)
        }
        .fliqScreen()
        .task { await flow.load() }
        .task(id: flow.nairaText) { await flow.refreshQuote() }
        .sensoryFeedback(.success, trigger: flow.step) { _, step in step == .done }
    }

    private var reached: Int {
        switch flow.step {
        case .amount, .signIn, .cancelled: 0
        case .pay: 1
        case .receiving, .done: 2
        }
    }

    @ViewBuilder
    private var content: some View {
        switch flow.step {
        case .amount: AmountStep(flow: flow)
        case .signIn: SignInStep(flow: flow)
        case .pay: PayStep(flow: flow)
        case .receiving: ReceivingStep(flow: flow)
        case .done: DoneStep(flow: flow, onDone: onDone)
        case .cancelled: CancelledStep(flow: flow)
        }
    }
}

private struct StepBar: View {
    let reached: Int
    private let titles = ["Amount", "Pay", "Receive"]

    var body: some View {
        HStack(spacing: 8) {
            ForEach(Array(titles.enumerated()), id: \.offset) { index, title in
                VStack(alignment: .leading, spacing: 8) {
                    Capsule()
                        .fill(index <= reached ? Theme.textPrimary : Theme.hairline)
                        .frame(height: 3)
                    Text(title)
                        .font(.system(size: 13, weight: index == reached ? .semibold : .regular))
                        .foregroundStyle(index <= reached ? Theme.textPrimary : Theme.textTertiary)
                }
            }
        }
        .animation(.easeInOut(duration: 0.3), value: reached)
    }
}

private struct AmountStep: View {
    let flow: BankDepositFlow

    var body: some View {
        VStack(spacing: 0) {
            if let notice = flow.notice {
                Text(notice)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
                    .padding(.bottom, 12)
            }
            VStack(alignment: .leading, spacing: 10) {
                Text("Amount in naira").font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("₦").font(.system(size: 34, weight: .light)).foregroundStyle(Theme.textTertiary)
                    Text(flow.nairaText.isEmpty ? "0" : flow.nairaText)
                        .font(.system(size: 52, weight: .regular))
                        .contentTransition(.numericText())
                        .animation(.snappy, value: flow.nairaText)
                }
                Text(estimateLine).font(.system(size: 16)).foregroundStyle(Theme.textPrimary)
                if let rate = flow.rate {
                    (Text("Rate  ").foregroundStyle(Theme.textSecondary) + Text("\(NairaFormat.rate(rate)) = $1.00").fontWeight(.semibold))
                        .font(.system(size: 14))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(18)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22))

            HStack(spacing: 8) {
                ForEach(BankDepositFlow.presets, id: \.self) { preset in
                    Button(NairaFormat.short(preset)) { flow.pick(preset) }
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(flow.naira == preset ? .black : Theme.textPrimary)
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .background(flow.naira == preset ? Color.white : Theme.surface, in: Capsule())
                        .buttonStyle(.pressable)
                }
            }
            .padding(.top, 12)

            Spacer(minLength: 8)
            AmountKeypad(text: flow.nairaText, onType: flow.enterAmount)
            if let message = flow.errorMessage {
                Text(message).font(.system(size: 13)).foregroundStyle(Theme.warning).padding(.top, 6)
            }
            Button { Task { await flow.getBankDetails() } } label: {
                if flow.isWorking {
                    HStack(spacing: 10) { ProgressView().tint(.black); Text("Getting bank details…") }
                } else {
                    Text("Get bank details")
                }
            }
            .buttonStyle(PrimaryButtonStyle(filled: true))
            .disabled(!flow.canContinue)
            .padding(.top, 8)
            .padding(.bottom, 12)
        }
    }

    private var estimateLine: String {
        guard let usdc = flow.usdcEstimate else { return "Type an amount" }
        return "You get about \(NairaFormat.dollars(usdc)) USDC"
    }
}

private struct SignInStep: View {
    @Bindable var flow: BankDepositFlow
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Confirm with Paj")
                .font(.system(size: 20, weight: .semibold))
            Text("Paj is the licensed partner that takes your Naira and sends USDC. Confirm your email or phone once and it stays signed in on this iPhone.")
                .font(.system(size: 15))
                .foregroundStyle(Theme.textSecondary)
            field("Email or +234 phone", text: $flow.contact, keyboard: .emailAddress)
                .disabled(flow.codeSent)
            if flow.codeSent {
                field("Code from Paj", text: $flow.code, keyboard: .numberPad)
                    .textContentType(.oneTimeCode)
            }
            if let message = flow.errorMessage {
                Text(message).font(.system(size: 13)).foregroundStyle(Theme.warning)
            }
            Spacer()
            Button {
                Task { flow.codeSent ? await flow.verify() : await flow.sendCode() }
            } label: {
                if flow.isWorking { ProgressView().tint(.black) } else { Text(flow.codeSent ? "Confirm and get bank details" : "Send code") }
            }
            .buttonStyle(PrimaryButtonStyle(filled: true))
            .disabled(flow.codeSent ? !flow.canVerify : !flow.canSendCode)
            .padding(.bottom, 12)
        }
        .onAppear { focused = true }
    }

    private func field(_ prompt: String, text: Binding<String>, keyboard: UIKeyboardType) -> some View {
        TextField("", text: text, prompt: Text(prompt).foregroundStyle(Theme.textTertiary))
            .focused($focused)
            .keyboardType(keyboard)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .font(.system(size: 17))
            .padding(.horizontal, 16)
            .frame(height: 56)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
    }
}

private struct PayStep: View {
    let flow: BankDepositFlow

    var body: some View {
        ScrollView {
            if let order = flow.order {
                VStack(alignment: .leading, spacing: 14) {
                    Label { Text("Waiting for your transfer") } icon: { Icon("clock", size: 18) }
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.textSecondary)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Transfer exactly").font(.system(size: 15)).foregroundStyle(Theme.textSecondary)
                        Text(NairaFormat.full(order.naira)).font(.system(size: 40, weight: .regular)).tracking(-0.8)
                    }
                    VStack(spacing: 0) {
                        CopyRow(label: "Amount", value: NairaFormat.full(order.naira), copy: String(order.naira))
                        CopyRow(label: "Bank", value: order.bank)
                        CopyRow(label: "Account number", value: order.accountNumber)
                        CopyRow(label: "Account name", value: order.accountName, isLast: true)
                    }
                    .background(Color.black, in: RoundedRectangle(cornerRadius: 18))
                    Text("You get about \(NairaFormat.dollars(order.usdc)) USDC in your vault.")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.textSecondary)
                    (Text("Rate  ").foregroundStyle(Theme.textSecondary) + Text("\(NairaFormat.rate(order.rate)) = $1.00").fontWeight(.semibold))
                        .font(.system(size: 14))
                    Text("Send from your own bank app, for exactly this amount. These details are for this deposit only.")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.textSecondary)
                    if flow.destination?.isTestWallet == true {
                        Callout(text: "Test build: the USDC goes to the team's Solana wallet, not your vault. On mainnet it lands in your vault.", symbol: "info.circle.fill", tint: Theme.warning)
                    }
                    if let message = flow.errorMessage {
                        Text(message).font(.system(size: 13)).foregroundStyle(Theme.warning)
                    }
                    Button("I've sent the money") { Task { await flow.watch() } }
                        .buttonStyle(PrimaryButtonStyle(filled: true))
                    Text("Tap once your bank app shows the transfer as sent. We check for it straight away.")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textTertiary)
                    Button("Cancel this deposit", action: flow.cancel)
                        .font(.system(size: 16))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                .padding(18)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 24))
                .padding(.bottom, 24)
            }
        }
        .scrollIndicators(.hidden)
    }
}

private struct CopyRow: View {
    let label: String
    let value: String
    var copy: String?
    var isLast = false
    @State private var copied = false

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(label).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                Text(value).font(.system(size: 17)).foregroundStyle(Theme.textPrimary)
            }
            Spacer()
            Button {
                UIPasteboard.general.string = copy ?? value
                copied = true
                Task { try? await Task.sleep(for: .seconds(1.5)); copied = false }
            } label: {
                Icon(copied ? "checkmark" : "doc.on.doc", size: 22)
                    .foregroundStyle(copied ? Theme.confirmed : Theme.textSecondary)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Copy \(label.lowercased())")
            .sensoryFeedback(.success, trigger: copied) { _, now in now }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) {
            if !isLast { Rectangle().fill(Theme.surface).frame(height: 1).padding(.horizontal, 16) }
        }
    }
}

private struct ReceivingStep: View {
    let flow: BankDepositFlow

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                ProgressView()
                Text(flow.isPaid ? "Transfer received" : "Waiting for your transfer")
                    .font(.system(size: 22, weight: .medium))
            }
            Text(detail).font(.system(size: 15)).foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22))
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private var detail: String {
        let usdc = flow.order.map { NairaFormat.dollars($0.usdc) } ?? ""
        if flow.order?.status == .completed { return "Moving \(usdc) into your vault." }
        if flow.isPaid { return "Sending about \(usdc) USDC to your balance." }
        return "We'll pick it up as soon as your bank sends it. This usually takes under a minute."
    }
}

private struct DoneStep: View {
    let flow: BankDepositFlow
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Icon("checkmark", size: 34)
                .foregroundStyle(Theme.confirmed)
                .frame(width: 84, height: 84)
                .overlay(Circle().strokeBorder(Theme.hairline))
            Text(flow.destination?.isTestWallet == true ? "Sent to the team's test wallet" : "Added to your balance")
                .font(.system(size: 16))
                .foregroundStyle(Theme.textSecondary)
            Text(flow.order.map { NairaFormat.dollars($0.usdc) } ?? "")
                .font(.system(size: 52, weight: .regular))
            Text("You paid \(flow.order.map { NairaFormat.full($0.naira) } ?? "") by bank transfer.")
                .font(.system(size: 15))
                .foregroundStyle(Theme.textSecondary)
            Button("Done", action: onDone)
                .buttonStyle(PrimaryButtonStyle(filled: true))
                .padding(.top, 8)
        }
        .padding(22)
        .frame(maxWidth: .infinity)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 24))
        .frame(maxHeight: .infinity, alignment: .top)
    }
}

private struct CancelledStep: View {
    let flow: BankDepositFlow

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("You cancelled this deposit").font(.system(size: 22, weight: .medium))
            Text("Don't send money to those details. Start a new deposit for fresh ones.")
                .font(.system(size: 15))
                .foregroundStyle(Theme.textSecondary)
            Button("Start a new deposit", action: flow.startOver)
                .buttonStyle(PrimaryButtonStyle(filled: true))
                .padding(.top, 6)
        }
        .padding(18)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22))
        .frame(maxHeight: .infinity, alignment: .top)
    }
}

enum NairaFormat {
    private static let grouped: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "en_NG")
        return formatter
    }()

    static func full(_ naira: Int) -> String {
        "₦" + (grouped.string(from: NSNumber(value: naira)) ?? String(naira)) + ".00"
    }

    static func short(_ naira: Int) -> String {
        "₦" + (grouped.string(from: NSNumber(value: naira)) ?? String(naira))
    }

    private static let twoDecimals: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "en_NG")
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        return formatter
    }()

    static func rate(_ rate: Double) -> String {
        "₦" + (twoDecimals.string(from: NSNumber(value: rate)) ?? String(rate))
    }

    /// USDC rounded down to the cent, so the screen never promises more than arrives.
    static func dollars(_ usdc: Double) -> String {
        String(format: "$%.2f", (usdc * 100).rounded(.down) / 100)
    }
}
