import SwiftUI
import UIKit

/// Add money by bank transfer. Every step is one card under the same header and step bar, so the screen
/// keeps its place while the card's contents change.
struct BankDepositView: View {
    @Bindable var flow: BankDepositFlow
    let onDone: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Add money · Nigeria")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textSecondary)
                Text("Add money by bank transfer")
                    .font(.system(size: 32, weight: .regular))
                    .tracking(-0.8)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .padding(.top, 8)
            StepBar(reached: reached)
                .padding(.top, 24)
            content
                .padding(.top, 24)
                .animation(.smooth(duration: 0.35), value: flow.step)
        }
        .fliqScreen()
        .task { await flow.load() }
        .task(id: flow.nairaText) { await flow.refreshQuote() }
        .sensoryFeedback(.success, trigger: flow.step) { _, step in step == .done }
    }

    private var reached: Int {
        switch flow.step {
        case .amount, .signIn, .cancelled: 0
        case .pay, .receiving: flow.isPaid ? 2 : 1
        case .done: 2
        }
    }

    @ViewBuilder
    private var content: some View {
        switch flow.step {
        case .amount: AmountStep(flow: flow)
        case .signIn: SignInStep(flow: flow)
        case .pay, .receiving:
            if flow.isPaid { ArrivingStep(flow: flow) } else { PayStep(flow: flow) }
        case .done: DoneStep(flow: flow, onDone: onDone)
        case .cancelled: CancelledStep(flow: flow)
        }
    }
}

// MARK: - Shared pieces

private enum Layout {
    static let cardPadding: CGFloat = 20
    static let cardRadius: CGFloat = 28
    static let groupRadius: CGFloat = 20
    static let card = Color.white.opacity(0.025)
    static let cardEdge = Color.white.opacity(0.08)
    static let inset = Color.white.opacity(0.05)
}

private struct DepositCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .padding(Layout.cardPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Layout.card, in: RoundedRectangle(cornerRadius: Layout.cardRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Layout.cardRadius, style: .continuous).strokeBorder(Layout.cardEdge))
    }
}

private struct StepBar: View {
    let reached: Int
    private let titles = ["Amount", "Pay", "Receive"]

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            ForEach(Array(titles.enumerated()), id: \.offset) { index, title in
                VStack(alignment: .leading, spacing: 10) {
                    Capsule()
                        .fill(index <= reached ? Theme.textPrimary : Theme.hairline)
                        .frame(height: 3)
                    Text(title)
                        .font(.system(size: 14, weight: index == reached ? .medium : .regular))
                        .foregroundStyle(index <= reached ? Theme.textPrimary : Theme.textTertiary)
                }
            }
        }
        .animation(.smooth(duration: 0.4), value: reached)
    }
}

private struct RateLine: View {
    let rate: Double

    var body: some View {
        HStack(spacing: 10) {
            Text("Rate").foregroundStyle(Theme.textSecondary)
            Text("\(NairaFormat.rate(rate)) = $1.00").fontWeight(.semibold).monospacedDigit()
        }
        .font(.system(size: 15))
    }
}

private struct Note: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 15))
            .foregroundStyle(Theme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Amount

private struct AmountStep: View {
    let flow: BankDepositFlow

    var body: some View {
        VStack(spacing: 0) {
            DepositCard {
                Text("Amount in naira")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textSecondary)
                HeroAmount(symbol: "₦", value: flow.nairaText.isEmpty ? "0" : NairaFormat.grouped(flow.naira), size: 52)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .padding(.top, 12)
                Text(estimate)
                    .font(.system(size: 16))
                    .foregroundStyle(Theme.textPrimary)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .animation(.snappy, value: flow.usdcEstimate)
                    .padding(.top, 14)
                if let rate = flow.rate {
                    RateLine(rate: rate).padding(.top, 18)
                    Text("Rates move through the day. Yours is fixed when you get your bank details.")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 6)
                }
                HStack(spacing: 8) {
                    ForEach(BankDepositFlow.presets, id: \.self) { preset in
                        PresetChip(title: NairaFormat.short(preset), picked: flow.naira == preset) { flow.pick(preset) }
                    }
                }
                .padding(.top, 22)
                if let message = flow.errorMessage ?? flow.notice {
                    Note(text: message).padding(.top, 14)
                }
                Button { Task { await flow.getBankDetails() } } label: {
                    if flow.isWorking {
                        HStack(spacing: 10) { ProgressView().tint(.black); Text("Getting bank details") }
                    } else {
                        Text("Get bank details")
                    }
                }
                .buttonStyle(PrimaryButtonStyle(filled: true))
                .disabled(!flow.canContinue)
                .padding(.top, 22)
                Note(text: "Next you get a bank account for this deposit. Pay into it from any Nigerian bank app.")
                    .padding(.top, 14)
            }
            Spacer(minLength: 12)
            AmountKeypad(text: flow.nairaText, onType: flow.enterAmount)
                .padding(.bottom, 8)
        }
    }

    private var estimate: String {
        guard let usdc = flow.usdcEstimate else { return "Type an amount" }
        return "You get about \(NairaFormat.dollars(usdc)) in your vault"
    }
}

private struct PresetChip: View {
    let title: String
    let picked: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .foregroundStyle(picked ? .black : Theme.textPrimary)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(picked ? Color.white : Layout.inset, in: Capsule())
        }
        .buttonStyle(.pressable)
        .animation(.snappy(duration: 0.25), value: picked)
    }
}

// MARK: - One-time Paj check

private struct SignInStep: View {
    @Bindable var flow: BankDepositFlow
    @FocusState private var focus: Field?

    private enum Field { case contact, code }

    var body: some View {
        VStack(spacing: 0) {
            DepositCard {
                Text(flow.codeSent ? "Enter the code" : "Confirm it's you")
                    .font(.system(size: 20, weight: .medium))
                Note(text: flow.codeSent
                    ? "Paj sent a code to \(flow.contact)."
                    : "Paj, the licensed partner that turns your Naira into dollars, checks who's paying once. After that this iPhone goes straight to your bank details.")
                    .padding(.top, 8)
                if flow.codeSent {
                    codeField.padding(.top, 20)
                    Button("Use a different email or number", action: flow.changeContact)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.textPrimary)
                        .padding(.top, 12)
                } else {
                    contactField.padding(.top, 20)
                }
                if let message = flow.errorMessage {
                    Text(message).font(.system(size: 14)).foregroundStyle(Theme.warning).padding(.top, 12)
                }
                Button {
                    Task { flow.codeSent ? await flow.verify() : await flow.sendCode() }
                } label: {
                    if flow.isWorking { ProgressView().tint(.black) } else { Text(flow.codeSent ? "Confirm and get bank details" : "Send code") }
                }
                .buttonStyle(PrimaryButtonStyle(filled: true))
                .disabled(flow.codeSent ? !flow.canVerify : !flow.canSendCode)
                .padding(.top, 22)
            }
            Spacer()
        }
        .animation(.smooth(duration: 0.3), value: flow.codeSent)
        .onAppear { focus = .contact }
        .onChange(of: flow.codeSent) { _, sent in focus = sent ? .code : .contact }
    }

    private var contactField: some View {
        TextField("", text: $flow.contact, prompt: Text("Email or +234 phone").foregroundStyle(Theme.textTertiary))
            .focused($focus, equals: .contact)
            .keyboardType(.emailAddress)
            .textContentType(.emailAddress)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.send)
            .onSubmit { Task { await flow.sendCode() } }
            .font(.system(size: 17))
            .padding(.horizontal, 18)
            .frame(height: 56)
            .background(Layout.inset, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var codeField: some View {
        TextField("", text: $flow.code, prompt: Text("Code").foregroundStyle(Theme.textTertiary))
            .focused($focus, equals: .code)
            .keyboardType(.numberPad)
            .textContentType(.oneTimeCode)
            .font(.system(size: 28, weight: .regular))
            .tracking(8)
            .monospacedDigit()
            .padding(.horizontal, 18)
            .frame(height: 64)
            .background(Layout.inset, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .onChange(of: flow.code) { _, typed in
                let digits = String(typed.filter(\.isNumber).prefix(8))
                if digits != typed { flow.code = digits }
            }
    }
}

// MARK: - Pay, then checking on the same card

private struct PayStep: View {
    let flow: BankDepositFlow

    private var checking: Bool { flow.step == .receiving }

    var body: some View {
        ScrollView {
            if let order = flow.order {
                DepositCard {
                    HStack(spacing: 10) {
                        if checking {
                            ProgressView().controlSize(.small)
                        } else {
                            Icon("clock", size: 18).foregroundStyle(Theme.textSecondary)
                        }
                        Text(checking ? "Checking for your transfer" : "Waiting for your transfer")
                            .contentTransition(.opacity)
                    }
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textSecondary)

                    Text("Transfer exactly")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.top, 18)
                    Text(NairaFormat.full(order.naira))
                        .font(.system(size: 46, weight: .regular))
                        .tracking(-1.2)
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .padding(.top, 2)

                    VStack(spacing: 0) {
                        CopyRow(label: "Amount", value: NairaFormat.full(order.naira), copy: String(order.naira))
                        CopyRow(label: "Bank", value: order.bank)
                        CopyRow(label: "Account number", value: order.accountNumber)
                        CopyRow(label: "Account name", value: order.accountName)
                    }
                    .padding(.vertical, 6)
                    .background(Layout.inset, in: RoundedRectangle(cornerRadius: Layout.groupRadius, style: .continuous))
                    .padding(.top, 18)

                    Text("You get about \(NairaFormat.dollars(order.usdc)) in your vault.")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.textPrimary)
                        .monospacedDigit()
                        .padding(.top, 18)
                    RateLine(rate: order.rate).padding(.top, 8)
                    Note(text: "Send from your own bank app, for exactly this amount. These details are for this deposit only.")
                        .padding(.top, 10)

                    if flow.destination?.isTestWallet == true {
                        Callout(text: "Test build: the USDC goes to the team's Solana wallet, not your vault. On mainnet it lands in your vault.", symbol: "info.circle.fill", tint: Theme.warning)
                            .padding(.top, 14)
                    }
                    if let message = flow.errorMessage {
                        Text(message).font(.system(size: 14)).foregroundStyle(Theme.warning).padding(.top, 14)
                    }

                    Group {
                        if checking {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(spacing: 10) {
                                    ProgressView().controlSize(.small)
                                    Text("Checking with the bank").font(.system(size: 18, weight: .medium))
                                }
                                Note(text: "Most transfers show up within a minute or two. You can close this screen: the money lands in your vault either way.")
                            }
                            .transition(.opacity.combined(with: .move(edge: .bottom)))
                        } else {
                            VStack(alignment: .leading, spacing: 14) {
                                Button("I've sent the money") { Task { await flow.watch() } }
                                    .buttonStyle(PrimaryButtonStyle(filled: true))
                                Note(text: "Tap once your bank app shows the transfer as sent. We check for it straight away.")
                            }
                            .transition(.opacity)
                        }
                    }
                    .padding(.top, 22)

                    Button("Cancel this deposit", action: flow.cancel)
                        .font(.system(size: 16))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .padding(.top, 14)
                }
                .animation(.smooth(duration: 0.35), value: checking)
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
    @State private var copied = false

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(label).font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
                Text(value).font(.system(size: 17)).foregroundStyle(Theme.textPrimary).monospacedDigit()
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
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(.pressable)
            .accessibilityLabel("Copy \(label.lowercased())")
            .sensoryFeedback(.success, trigger: copied) { _, now in now }
        }
        .padding(.leading, 18)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
    }
}

// MARK: - Arriving, done, cancelled

private struct ArrivingStep: View {
    let flow: BankDepositFlow

    var body: some View {
        VStack(spacing: 0) {
            DepositCard {
                HStack(spacing: 12) {
                    ProgressView()
                    Text("Transfer received").font(.system(size: 24, weight: .regular)).tracking(-0.4)
                }
                Note(text: "Moving about \(flow.order.map { NairaFormat.dollars($0.usdc) } ?? "") into your vault.")
                    .padding(.top, 10)
            }
            Spacer()
        }
    }
}

private struct DoneStep: View {
    let flow: BankDepositFlow
    let onDone: () -> Void
    @State private var shown = false

    var body: some View {
        VStack(spacing: 0) {
            DepositCard {
                Icon("checkmark", size: 22)
                    .foregroundStyle(.black)
                    .frame(width: 44, height: 44)
                    .background(Theme.confirmed, in: Circle())
                    .scaleEffect(shown ? 1 : 0.5)
                    .opacity(shown ? 1 : 0)
                Text(flow.destination?.isTestWallet == true ? "Sent to the team's test wallet" : "Added to your vault")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.top, 18)
                Text(flow.order.map { NairaFormat.dollars($0.usdc) } ?? "")
                    .font(.system(size: 46, weight: .regular))
                    .tracking(-1.2)
                    .monospacedDigit()
                    .padding(.top, 2)
                if let order = flow.order {
                    VStack(spacing: 0) {
                        SummaryRow(label: "You paid", value: NairaFormat.full(order.naira))
                        SummaryRow(label: "Rate", value: "\(NairaFormat.rate(order.rate)) = $1.00")
                        SummaryRow(label: "Through", value: "Paj, by bank transfer")
                    }
                    .padding(.vertical, 6)
                    .background(Layout.inset, in: RoundedRectangle(cornerRadius: Layout.groupRadius, style: .continuous))
                    .padding(.top, 18)
                }
                Button("Done", action: onDone)
                    .buttonStyle(PrimaryButtonStyle(filled: true))
                    .padding(.top, 22)
            }
            Spacer()
        }
        .onAppear { withAnimation(.spring(response: 0.45, dampingFraction: 0.6)) { shown = true } }
    }
}

private struct SummaryRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label).foregroundStyle(Theme.textSecondary)
            Spacer()
            Text(value).foregroundStyle(Theme.textPrimary).monospacedDigit()
        }
        .font(.system(size: 15))
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
    }
}

private struct CancelledStep: View {
    let flow: BankDepositFlow

    var body: some View {
        VStack(spacing: 0) {
            DepositCard {
                Text("You cancelled this deposit").font(.system(size: 24, weight: .regular)).tracking(-0.4)
                Note(text: "Don't send money to those bank details. Start a new deposit for fresh ones.")
                    .padding(.top, 10)
                Button("Start a new deposit", action: flow.startOver)
                    .buttonStyle(PrimaryButtonStyle(filled: true))
                    .padding(.top, 22)
            }
            Spacer()
        }
    }
}

enum NairaFormat {
    private static let groupedFormatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "en_NG")
        return formatter
    }()

    static func grouped(_ naira: Int) -> String {
        groupedFormatter.string(from: NSNumber(value: naira)) ?? String(naira)
    }

    static func full(_ naira: Int) -> String {
        "₦" + grouped(naira) + ".00"
    }

    static func short(_ naira: Int) -> String {
        "₦" + grouped(naira)
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
