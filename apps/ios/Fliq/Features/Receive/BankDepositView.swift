import SwiftUI
import UIKit

struct BankDepositView: View {
    @Bindable var flow: BankDepositFlow
    let onDone: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if flow.step != .done {
                header
                if flow.step != .cancelled {
                    StepBar(reached: reached).padding(.top, 20)
                }
            }
            content
                .padding(.top, flow.step == .done ? 0 : 20)
                .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))
                .id(flow.step)
        }
        .animation(.spring(response: 0.45, dampingFraction: 0.86), value: flow.step)
        .fliqScreen(aurora: Aurora(accent: flow.step == .done ? Theme.confirmed : nil, strength: flow.step == .done ? 0.9 : 0.45))
        .task { await flow.load() }
        .task(id: flow.nairaText) { await flow.refreshQuote() }
        .sensoryFeedback(.success, trigger: flow.step) { _, step in step == .done }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Text("🇳🇬")
                Text("Naira in · with Paj")
            }
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Theme.textSecondary)
            .padding(.horizontal, 12)
            .frame(height: 30)
            .fliqGlass(Capsule())
            Text(title)
                .font(.system(size: 30, weight: .semibold))
                .tracking(-0.6)
                .contentTransition(.opacity)
        }
    }

    private var title: String {
        switch flow.step {
        case .amount: "Add money"
        case .signIn: "One quick check"
        case .pay: "Send \(flow.order.map { NairaFormat.short($0.naira) } ?? "the money")"
        case .receiving: "On its way"
        case .done: ""
        case .cancelled: "Deposit cancelled"
        }
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
    private let titles = ["Amount", "Transfer", "Arrives"]

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(titles.enumerated()), id: \.offset) { index, title in
                VStack(alignment: .leading, spacing: 8) {
                    Capsule()
                        .fill(Theme.hairline)
                        .frame(height: 4)
                        .overlay(alignment: .leading) {
                            Capsule()
                                .fill(index < reached ? Theme.confirmed : Color.white)
                                .frame(maxWidth: index <= reached ? .infinity : 0)
                        }
                    Text(title)
                        .font(.system(size: 12, weight: index == reached ? .semibold : .medium))
                        .foregroundStyle(index <= reached ? Theme.textPrimary : Theme.textTertiary)
                }
            }
        }
        .animation(.spring(response: 0.5, dampingFraction: 0.8), value: reached)
    }
}

private struct AmountStep: View {
    let flow: BankDepositFlow

    var body: some View {
        VStack(spacing: 0) {
            if let notice = flow.notice {
                Callout(text: notice, symbol: "info.circle.fill", tint: Theme.textSecondary)
                    .padding(.bottom, 8)
            }
            Spacer(minLength: 8)
            VStack(spacing: 14) {
                HeroAmount(symbol: "₦", value: flow.nairaText.isEmpty ? "0" : NairaFormat.grouped(flow.naira), size: 60)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                landsChip
                if let rate = flow.rate {
                    Text("\(NairaFormat.rate(rate)) = $1 · Paj's rate")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textTertiary)
                        .monospacedDigit()
                }
            }
            .frame(maxWidth: .infinity)
            Spacer(minLength: 12)

            HStack(spacing: 8) {
                ForEach(BankDepositFlow.presets, id: \.self) { preset in
                    let picked = flow.naira == preset
                    Button(NairaFormat.short(preset)) { flow.pick(preset) }
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(picked ? .black : Theme.textPrimary)
                        .frame(maxWidth: .infinity, minHeight: 38)
                        .background { if picked { Capsule().fill(Color.white) } else { Color.clear.fliqGlass(Capsule(), interactive: true) } }
                        .buttonStyle(.pressable)
                        .animation(.snappy, value: picked)
                }
            }
            AmountKeypad(text: flow.nairaText, onType: flow.enterAmount)
                .padding(.top, 4)
            if let message = flow.errorMessage {
                Text(message).font(.system(size: 13)).foregroundStyle(Theme.warning).padding(.top, 6)
            }
            Button { Task { await flow.getBankDetails() } } label: {
                if flow.isWorking {
                    HStack(spacing: 10) { ProgressView().tint(.black); Text("Getting bank details…") }
                } else {
                    Text(flow.naira < 100 && flow.naira > 0 ? "₦100 minimum" : "Continue")
                }
            }
            .buttonStyle(PrimaryButtonStyle(filled: true))
            .disabled(!flow.canContinue)
            .padding(.top, 8)
            .padding(.bottom, 12)
        }
    }

    private var landsChip: some View {
        HStack(spacing: 8) {
            Icon("arrow.down", size: 14)
            if let usdc = flow.usdcEstimate {
                (Text("About ") + Text(NairaFormat.dollars(usdc)).fontWeight(.semibold).foregroundStyle(Theme.textPrimary) + Text(" lands in your vault"))
                    .contentTransition(.numericText())
            } else {
                Text("Type an amount")
            }
        }
        .font(.system(size: 15))
        .foregroundStyle(Theme.textSecondary)
        .monospacedDigit()
        .padding(.horizontal, 16)
        .frame(height: 40)
        .fliqGlass(Capsule())
        .animation(.snappy, value: flow.usdcEstimate)
    }
}

private struct SignInStep: View {
    @Bindable var flow: BankDepositFlow
    @FocusState private var focus: Field?

    private enum Field { case contact, code }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Paj is the licensed partner that turns your Naira into dollars. They check who's paying once, then this iPhone stays signed in.")
                .font(.system(size: 15))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 12) {
                CheckStep(number: 1, text: "Your email or +234 number", state: flow.codeSent ? .done : .current)
                CheckStep(number: 2, text: "The code Paj sends you", state: flow.codeSent ? .current : .waiting)
                CheckStep(number: 3, text: "Get your bank details", state: .waiting)
            }

            if flow.codeSent {
                codeEntry
            } else {
                contactField
            }
            if let message = flow.errorMessage {
                Label { Text(message) } icon: { Icon("exclamationmark.circle", size: 16) }
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.warning)
            }
            Spacer()
            Button {
                Task { flow.codeSent ? await flow.verify() : await flow.sendCode() }
            } label: {
                if flow.isWorking { ProgressView().tint(.black) } else { Text(flow.codeSent ? "Confirm" : "Send code") }
            }
            .buttonStyle(PrimaryButtonStyle(filled: true))
            .disabled(flow.codeSent ? !flow.canVerify : !flow.canSendCode)
            .padding(.bottom, 12)
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: flow.codeSent)
        .onAppear { focus = .contact }
        .onChange(of: flow.codeSent) { _, sent in focus = sent ? .code : .contact }
    }

    private var contactField: some View {
        HStack(spacing: 12) {
            Icon(flow.contact.contains("@") || flow.contact.isEmpty ? "at" : "iphone", size: 20)
                .foregroundStyle(Theme.textSecondary)
            TextField("", text: $flow.contact, prompt: Text("you@email.com or +234…").foregroundStyle(Theme.textTertiary))
                .focused($focus, equals: .contact)
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.send)
                .onSubmit { Task { await flow.sendCode() } }
            if BankDepositFlow.isContact(flow.contact) {
                Icon("checkmark.circle.fill", size: 20)
                    .foregroundStyle(Theme.confirmed)
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .font(.system(size: 17))
        .padding(.horizontal, 16)
        .frame(height: 58)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(focus == .contact ? Color.white.opacity(0.35) : .clear))
        .animation(.snappy, value: BankDepositFlow.isContact(flow.contact))
    }

    private var codeEntry: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Text("Sent to").foregroundStyle(Theme.textSecondary)
                Text(flow.contact).fontWeight(.semibold).lineLimit(1).truncationMode(.middle)
                Spacer()
                Button("Change", action: flow.changeContact)
                    .fontWeight(.semibold)
                    .foregroundStyle(Theme.textPrimary)
            }
            .font(.system(size: 14))
            TextField("", text: $flow.code, prompt: Text("Code").foregroundStyle(Theme.textTertiary))
                .focused($focus, equals: .code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .font(.system(size: 30, weight: .medium, design: .rounded))
                .tracking(10)
                .monospacedDigit()
                .multilineTextAlignment(.center)
                .frame(height: 68)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.white.opacity(0.35)))
                .onChange(of: flow.code) { _, typed in
                    let digits = String(typed.filter(\.isNumber).prefix(8))
                    if digits != typed { flow.code = digits }
                }
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}

private struct CheckStep: View {
    enum State { case waiting, current, done }
    let number: Int
    let text: String
    let state: State

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(state == .done ? Theme.confirmed : state == .current ? Color.white : Theme.surface)
                if state == .done {
                    Icon("checkmark", size: 13).foregroundStyle(.white)
                } else {
                    Text("\(number)")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(state == .current ? .black : Theme.textTertiary)
                }
            }
            .frame(width: 26, height: 26)
            Text(text)
                .font(.system(size: 15, weight: state == .current ? .semibold : .regular))
                .foregroundStyle(state == .waiting ? Theme.textTertiary : Theme.textPrimary)
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.7), value: state)
    }
}

private struct PayStep: View {
    let flow: BankDepositFlow

    var body: some View {
        ScrollView {
            if let order = flow.order {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 0) {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Transfer exactly").font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
                                HeroAmount(symbol: "₦", value: NairaFormat.grouped(order.naira), size: 44)
                            }
                            Spacer()
                            CopyButton(label: "amount", value: String(order.naira))
                        }
                        .padding(16)
                        Rectangle().fill(Color(hex: 0x262626)).frame(height: 1)
                        CopyRow(label: "Account number", value: order.accountNumber, large: true)
                        CopyRow(label: "Bank", value: order.bank)
                        CopyRow(label: "Account name", value: order.accountName, isLast: true)
                    }
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22))

                    HStack(spacing: 12) {
                        Icon("arrow.down", size: 18)
                            .foregroundStyle(Theme.confirmed)
                            .frame(width: 36, height: 36)
                            .background(Theme.confirmed.opacity(0.14), in: Circle())
                        VStack(alignment: .leading, spacing: 2) {
                            (Text("About ") + Text(NairaFormat.dollars(order.usdc)).fontWeight(.semibold) + Text(" lands in your vault"))
                                .font(.system(size: 15))
                            Text("\(NairaFormat.rate(order.rate)) = $1")
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textTertiary)
                        }
                        .monospacedDigit()
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Tip(symbol: "building.columns", text: "Pay from any Nigerian bank app: OPay, GTBank, Kuda, Moniepoint.")
                        Tip(symbol: "exclamationmark.circle", text: "Send the exact amount, once. These details are for this deposit only.")
                    }

                    if flow.destination?.isTestWallet == true {
                        Callout(text: "Test build: the USDC goes to the team's Solana wallet, not your vault. On mainnet it lands in your vault.", symbol: "info.circle.fill", tint: Theme.warning)
                    }
                    if let message = flow.errorMessage {
                        Text(message).font(.system(size: 13)).foregroundStyle(Theme.warning)
                    }
                    Button("I've sent \(NairaFormat.short(order.naira))") { Task { await flow.watch() } }
                        .buttonStyle(PrimaryButtonStyle(filled: true))
                        .padding(.top, 4)
                    Button("Cancel this deposit", action: flow.cancel)
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity)
                }
                .padding(.bottom, 24)
            }
        }
        .scrollIndicators(.hidden)
    }
}

private struct Tip: View {
    let symbol: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Icon(symbol, size: 16).foregroundStyle(Theme.textTertiary).padding(.top, 1)
            Text(text).font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
        }
    }
}

private struct CopyRow: View {
    let label: String
    let value: String
    var large = false
    var isLast = false

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(label).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                Text(value)
                    .font(.system(size: large ? 22 : 17, weight: large ? .medium : .regular))
                    .tracking(large ? 1.5 : 0)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textPrimary)
            }
            Spacer()
            CopyButton(label: label.lowercased(), value: value)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) {
            if !isLast { Rectangle().fill(Color(hex: 0x262626)).frame(height: 1).padding(.horizontal, 16) }
        }
    }
}

private struct CopyButton: View {
    let label: String
    let value: String
    @State private var copied = false

    var body: some View {
        Button {
            UIPasteboard.general.string = value
            copied = true
            Task { try? await Task.sleep(for: .seconds(1.5)); copied = false }
        } label: {
            HStack(spacing: 6) {
                Icon(copied ? "checkmark" : "doc.on.doc", size: 16)
                Text(copied ? "Copied" : "Copy")
            }
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(copied ? Theme.confirmed : Theme.textPrimary)
            .padding(.horizontal, 12)
            .frame(height: 34)
            .fliqGlass(Capsule(), interactive: true)
            .animation(.snappy, value: copied)
        }
        .buttonStyle(.pressable)
        .accessibilityLabel("Copy \(label)")
        .sensoryFeedback(.success, trigger: copied) { _, now in now }
    }
}

private struct ReceivingStep: View {
    let flow: BankDepositFlow

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("We're watching for your transfer. You can leave this screen, the money still lands.")
                .font(.system(size: 15))
                .foregroundStyle(Theme.textSecondary)
                .padding(.bottom, 24)
            TrackRow(title: "Transfer sent", detail: "From your bank app", state: .done, isLast: false)
            TrackRow(title: "Paj received your Naira", detail: naira, state: flow.isPaid ? .done : .current, isLast: false)
            TrackRow(title: "Dollars in your vault", detail: dollars, state: flow.isPaid ? .current : .waiting, isLast: true)
            Spacer()
            Text("Usually under two minutes.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textTertiary)
                .frame(maxWidth: .infinity)
                .padding(.bottom, 16)
        }
    }

    private var naira: String { flow.order.map { NairaFormat.full($0.naira) } ?? "" }
    private var dollars: String { flow.order.map { "About \(NairaFormat.dollars($0.usdc)) USDC" } ?? "" }
}

private struct TrackRow: View {
    enum State { case waiting, current, done }
    let title: String
    let detail: String
    let state: State
    let isLast: Bool
    @SwiftUI.State private var pulse = false

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 0) {
                ZStack {
                    if state == .current {
                        Circle().fill(Color.white.opacity(0.18)).scaleEffect(pulse ? 1.6 : 1).opacity(pulse ? 0 : 1)
                    }
                    Circle().fill(state == .done ? Theme.confirmed : state == .current ? Color.white : Theme.surface)
                    if state == .done {
                        Icon("checkmark", size: 14).foregroundStyle(.white)
                    } else if state == .current {
                        ProgressView().controlSize(.mini).tint(.black)
                    }
                }
                .frame(width: 28, height: 28)
                if !isLast {
                    Rectangle()
                        .fill(state == .done ? Theme.confirmed : Theme.hairline)
                        .frame(width: 2, height: 40)
                }
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 17, weight: state == .waiting ? .regular : .semibold))
                    .foregroundStyle(state == .waiting ? Theme.textTertiary : Theme.textPrimary)
                Text(detail)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textTertiary)
                    .monospacedDigit()
            }
            .padding(.top, 3)
        }
        .animation(.spring(response: 0.45, dampingFraction: 0.75), value: state)
        .onAppear {
            withAnimation(.easeOut(duration: 1.3).repeatForever(autoreverses: false)) { pulse = true }
        }
    }
}

private struct DoneStep: View {
    let flow: BankDepositFlow
    let onDone: () -> Void
    @State private var shown = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            Icon("checkmark", size: 38)
                .foregroundStyle(.white)
                .frame(width: 92, height: 92)
                .background(Theme.confirmed, in: Circle())
                .scaleEffect(shown ? 1 : 0.4)
                .opacity(shown ? 1 : 0)
            Text(flow.destination?.isTestWallet == true ? "Sent to the team's test wallet" : "Added to your vault")
                .font(.system(size: 17))
                .foregroundStyle(Theme.textSecondary)
                .padding(.top, 24)
            HeroAmount(symbol: "$", value: flow.order.map { String(NairaFormat.dollars($0.usdc).dropFirst()) } ?? "", size: 64)
                .padding(.top, 6)
            Spacer()
            if let order = flow.order {
                DetailCard {
                    DetailRow("You paid", NairaFormat.full(order.naira))
                    DetailRow("Rate", "\(NairaFormat.rate(order.rate)) = $1")
                    DetailRow("Through", "Paj, by bank transfer", isLast: true)
                }
                .padding(.bottom, 16)
            }
            Button("Done", action: onDone)
                .buttonStyle(PrimaryButtonStyle(filled: true))
                .padding(.bottom, 12)
        }
        .onAppear {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.6).delay(0.1)) { shown = true }
        }
    }
}

private struct CancelledStep: View {
    let flow: BankDepositFlow

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Callout(text: "Don't send money to those bank details. They were for that deposit only.", symbol: "exclamationmark.triangle.fill", tint: Theme.warning)
            Text("Nothing was taken. Start again whenever you're ready and you'll get fresh details.")
                .font(.system(size: 15))
                .foregroundStyle(Theme.textSecondary)
            Spacer()
            Button("Start a new deposit", action: flow.startOver)
                .buttonStyle(PrimaryButtonStyle(filled: true))
                .padding(.bottom, 12)
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
