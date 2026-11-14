import Foundation
import Observation

/// Where Paj should send the USDC. On mainnet it is a NEAR Intents deposit address that carries it into the vault;
/// a testnet build has no such address, so it names a team wallet instead and says so on screen.
struct BankDepositDestination: Equatable, Sendable {
    let address: String
    var deposit: DepositAddress?
    var isTestWallet = false
}

/// Add money by bank transfer: type Naira, confirm with Paj once, pay the account Paj gives, watch it land.
@MainActor
@Observable
final class BankDepositFlow {
    enum Step: Equatable {
        case amount, signIn, pay, receiving, done, cancelled
    }

    static let presets = [5_000, 10_000, 20_000, 50_000]
    static let quoteDelay: Duration = .milliseconds(400)

    private(set) var step = Step.amount
    private(set) var nairaText = "5000"
    private(set) var rate: Double?
    private(set) var quote: Paj.Quote?
    private(set) var order: Paj.Order?
    private(set) var destination: BankDepositDestination?
    private(set) var isWorking = false
    private(set) var codeSent = false
    private(set) var errorMessage: String?
    private(set) var notice: String?
    var contact = ""
    var code = ""

    private let paj: any PajAPI
    private let signIn: any PajSignIn
    private let sessions: PajSessionStore?
    private let destinationFor: @Sendable () async throws -> BankDepositDestination
    private let deposits: (any DepositAPI)?
    private var session: Paj.Session?
    var pollInterval: Duration = .seconds(4)

    init(
        paj: any PajAPI,
        signIn: any PajSignIn,
        sessions: PajSessionStore? = PajSessionStore(),
        deposits: (any DepositAPI)? = nil,
        destination: @escaping @Sendable () async throws -> BankDepositDestination
    ) {
        self.paj = paj
        self.signIn = signIn
        self.sessions = sessions
        self.deposits = deposits
        destinationFor = destination
        session = sessions?.load()
        contact = sessions?.lastContact() ?? ""
    }

    var naira: Int { Int(nairaText) ?? 0 }
    var isSignedIn: Bool { session != nil }

    /// What the user gets, from Paj's quote when signed in, otherwise from the public rate.
    var usdcEstimate: Double? {
        if let quote, quote.naira == naira { return quote.usdc }
        guard let rate, rate > 0, naira > 0 else { return nil }
        return Double(naira) / rate
    }

    var canContinue: Bool { naira >= 100 && !isWorking }
    var canSendCode: Bool { Self.isContact(contact) && !isWorking }
    var canVerify: Bool { code.count >= 4 && code.allSatisfy(\.isNumber) && !isWorking }

    func load() async {
        rate = try? await paj.publicRate()
        await refreshQuote()
    }

    /// Whole Naira only: Paj quotes and collects whole amounts.
    @discardableResult
    func enterAmount(_ typed: String) -> String {
        let digits = String(typed.filter(\.isNumber).drop { $0 == "0" }.prefix(9))
        nairaText = digits
        errorMessage = nil
        return digits
    }

    func pick(_ preset: Int) {
        nairaText = String(preset)
        errorMessage = nil
    }

    /// The view calls it with `task(id: nairaText)`, so a newer keystroke cancels the older quote.
    func refreshQuote() async {
        guard let session, naira > 0 else { return }
        try? await Task.sleep(for: Self.quoteDelay)
        guard !Task.isCancelled else { return }
        if let fresh = try? await paj.quote(naira: naira, session: session), fresh.naira == naira {
            quote = fresh
            rate = fresh.rate
        }
    }

    func getBankDetails() async {
        guard canContinue else { return }
        guard let session else {
            step = .signIn
            return
        }
        await createOrder(session)
    }

    func sendCode() async {
        guard canSendCode else { return }
        await working {
            try await signIn.sendCode(to: contact.trimmingCharacters(in: .whitespaces))
            codeSent = true
        }
    }

    func verify() async {
        guard canVerify else { return }
        await working {
            let fresh = try await signIn.verify(contact.trimmingCharacters(in: .whitespaces), code: code)
            sessions?.save(fresh)
            session = fresh
        }
        if let session { await createOrder(session) }
    }

    func changeContact() {
        codeSent = false
        code = ""
        errorMessage = nil
    }

    /// Paj has no cancel call: the account simply goes unused, so the screen tells the user not to pay into it.
    func cancel() {
        step = .cancelled
        notice = nil
    }

    func startOver() {
        order = nil
        destination = nil
        step = .amount
        notice = "Deposit cancelled. You can start a new one now."
    }

    /// After "I've sent the money": follow Paj until it has paid out, then the vault deposit if there is one.
    func watch() async {
        guard let session, let current = order else { return }
        step = .receiving
        while !Task.isCancelled {
            if let fresh = try? await paj.order(current.id, session: session) {
                order = fresh
                switch fresh.status {
                case .completed:
                    await waitForVault()
                    step = .done
                    return
                case .failed, .cancelled:
                    errorMessage = "Paj couldn't finish this deposit. If money left your bank, Paj refunds it."
                    step = .pay
                    return
                default: break
                }
            }
            try? await Task.sleep(for: pollInterval)
        }
    }

    var isPaid: Bool { order?.status == .paid || order?.status == .completed }

    private func createOrder(_ session: Paj.Session) async {
        await working {
            let target = try await destinationFor()
            destination = target
            order = try await paj.createOrder(naira: naira, recipient: target.address, session: session)
            step = .pay
            notice = nil
        }
    }

    private func waitForVault() async {
        guard let deposits, let deposit = destination?.deposit else { return }
        for _ in 0..<40 where !Task.isCancelled {
            if let status = try? await deposits.status(of: deposit), status.stage.isFinal { return }
            try? await Task.sleep(for: pollInterval)
        }
    }

    private func working(_ body: () async throws -> Void) async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            try await body()
        } catch {
            errorMessage = DepositFailure.message(for: error)
        }
    }

    static func isContact(_ text: String) -> Bool {
        let value = text.trimmingCharacters(in: .whitespaces)
        if value.contains("@") { return value.range(of: #"^[^@\s]+@[^@\s]+\.[^@\s]+$"#, options: .regularExpression) != nil }
        return value.range(of: #"^\+[0-9]{8,15}$"#, options: .regularExpression) != nil
    }
}
