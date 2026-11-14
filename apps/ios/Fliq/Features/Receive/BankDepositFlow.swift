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
        case amount, signIn, pay, receiving, done, notReceived, cancelled
    }

    static let presets = [5_000, 10_000, 20_000, 50_000]
    static let quoteDelay: Duration = .milliseconds(400)
    /// Used until the API's own minimum has loaded. It mirrors SOURCES in services/api/apps/api/src/deposits.ts.
    static let fallbackMinimum = TokenAmount(baseUnits: TokenAmount.base)
    /// Paj takes its fee out of the rate estimate, so without Paj's quote the estimate must clear the minimum by half.
    static let unquotedMargin = 1.5

    private(set) var step = Step.amount
    /// True when the wait for the vault ran out before the money landed.
    private(set) var isStillMoving = false
    private(set) var nairaText = "5000"
    private(set) var rate: Double?
    private(set) var quote: Paj.Quote?
    private(set) var order: Paj.Order?
    private(set) var destination: BankDepositDestination?
    private(set) var isWorking = false
    private(set) var codeSent = false
    private(set) var errorMessage: String?
    private(set) var notice: String?
    /// The least the deposit address passes on to the vault. Nil when the money goes to a test wallet, which takes anything.
    private(set) var minimum: TokenAmount?
    var contact = ""
    var code = ""

    private let paj: any PajAPI
    private let signIn: any PajSignIn
    private let sessions: PajSessionStore?
    private let destinationFor: @Sendable () async throws -> BankDepositDestination
    private let deposits: (any DepositAPI)?
    private let route: DepositSource?
    private var session: Paj.Session?
    var pollInterval: Duration = .seconds(4)

    init(
        paj: any PajAPI,
        signIn: any PajSignIn,
        sessions: PajSessionStore? = PajSessionStore(),
        deposits: (any DepositAPI)? = nil,
        route: DepositSource? = nil,
        destination: @escaping @Sendable () async throws -> BankDepositDestination
    ) {
        self.paj = paj
        self.signIn = signIn
        self.sessions = sessions
        self.deposits = deposits
        self.route = route
        minimum = route.map { $0.minimum ?? Self.fallbackMinimum }
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

    var canContinue: Bool { naira >= 100 && clearsMinimum && !isWorking }

    /// Less than the minimum never arrives: the deposit address hands it back instead of passing it to the vault.
    var clearsMinimum: Bool {
        guard let floor = minimumUSDC else { return true }
        if let quote, quote.naira == naira { return quote.usdc >= floor }
        guard let rate, rate > 0 else { return false }
        return Double(naira) / rate >= floor * Self.unquotedMargin
    }

    /// The smallest amount sure to clear the minimum at today's rate, rounded up to the next ₦100.
    var smallestNaira: Int? {
        guard let floor = minimumUSDC, let rate, rate > 0 else { return nil }
        return Int((floor * Self.unquotedMargin * rate / 100).rounded(.up)) * 100
    }

    var minimumNote: String? {
        guard naira > 0, !clearsMinimum, let smallestNaira else { return nil }
        return naira < smallestNaira
            ? "The smallest amount is about \(NairaFormat.short(smallestNaira))."
            : "This amount is too small to arrive after fees. Try a larger one."
    }

    private var minimumUSDC: Double? {
        minimum.map { Double($0.baseUnits) / Double(TokenAmount.base) }
    }
    var canSendCode: Bool { Self.isContact(contact) && !isWorking }
    var canVerify: Bool { code.count >= 4 && code.allSatisfy(\.isNumber) && !isWorking }

    func load() async {
        rate = try? await paj.publicRate()
        await loadMinimum()
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
                    step = await reachesVault() ? .done : .notReceived
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
            let placed = try await paj.createOrder(naira: naira, recipient: target.address, session: session)
            // Paj fixes the amount only now. Bank details for an order that cannot arrive are never shown.
            guard placed.usdc >= minimumUSDC ?? 0 else {
                quote = Paj.Quote(naira: placed.naira, usdc: placed.usdc, rate: placed.rate)
                step = .amount
                return
            }
            order = placed
            step = .pay
            notice = nil
        }
    }

    private func loadMinimum() async {
        guard let route, let deposits, let sources = try? await deposits.sources() else { return }
        minimum = sources.first { $0.id == route.id }?.minimum ?? minimum
    }

    /// False when the deposit address got the money and will not pass it on. A wait that runs out is neither:
    /// the money is still moving, and the last screen must not say it has landed.
    private func reachesVault() async -> Bool {
        isStillMoving = false
        guard let deposits, let deposit = destination?.deposit else { return true }
        for _ in 0..<40 where !Task.isCancelled {
            if let stage = try? await deposits.status(of: deposit).stage {
                if stage.isNotComing { return false }
                if stage.isFinal { return true }
            }
            try? await Task.sleep(for: pollInterval)
        }
        isStillMoving = true
        return true
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
