import Foundation

/// Serves the canonical responses in `spec/fixtures`, bundled with the app, so every screen
/// shows the same numbers as the web, the mock server and the demo.
///
/// Demo knob: a payout quoted at exactly $13 is refunded instead of settled, so the
/// failure path in the demo script can be shown on purpose.
struct FixtureClient: FliqAPI {
    static let refundDemoAmount = TokenAmount(baseUnits: 13_000_000)

    var bundle: Bundle = .main
    private let ledger = FixtureLedger()

    func health() async throws -> Health {
        try load("health")
    }

    func rate(_ token: Token, _ currency: Currency) async throws -> Rate {
        try load("rate.usdc-ngn")
    }

    func quote(_ request: QuoteRequest) async throws -> Quote {
        await ledger.quoted(request.amount)
        return try load("quote.usdc-ngn-50")
    }

    func verify(_ account: Account) async throws -> VerifiedAccount {
        try load("verify.gtbank-0123456789")
    }

    func createPayout(_ request: PayoutRequest, idempotencyKey: String) async throws -> Payout {
        let created: Payout = try load("payout.created")
        let id = await ledger.open(idempotencyKey: idempotencyKey)
        return created.with(id: id)
    }

    /// Each poll moves one step along the fixture's history, so the Sending timeline plays
    /// out the way a real payout does instead of jumping to the end.
    func payout(id: String) async throws -> Payout {
        let settled: Payout = try load("payout.settled")
        let (step, refunds) = await ledger.poll(id)
        let path = refunds ? settled.refundedPath() : settled
        return path.with(id: id).upTo(step: min(step, path.history.count - 1))
    }

    func payouts() async throws -> PayoutList {
        try load("payouts.list")
    }

    var needsSignIn: Bool {
        get async { false }
    }

    func passkeyOptions(_ purpose: PasskeyPurpose) async throws -> PasskeyOptions {
        try load("passkey.options")
    }

    func finishPasskey(_ purpose: PasskeyPurpose, challengeId: String, credential: Data) async throws -> User {
        let session: Session = try load("session.signed-in")
        return session.user
    }

    func sendEmailLink(to email: String) async throws -> EmailLinkSent {
        try load("email-link.sent")
    }

    func verifyEmailLink(token: String) async throws -> User {
        let session: Session = try load("session.signed-in")
        return session.user
    }

    func signOut() async {}

    func me() async throws -> User {
        try load("user.new")
    }

    func checkName(_ name: FliqName) async throws -> NameAvailability {
        let free = try await FixtureNameDirectory().isAvailable(name)
        return NameAvailability(name: name.value, available: free, reason: free ? nil : "taken")
    }

    func claimName(_ name: FliqName, publicKey: String) async throws -> User {
        let user: User = try load("user.new")
        return user.named(name.account)
    }

    func updateProfile(displayName: String) async throws -> User {
        try load("user.new")
    }

    func updateProfilePhoto(_ url: URL) async throws -> User {
        let user: User = try load("user.new")
        return user.photographed(url)
    }

    func institutions(in country: Country) async throws -> [Institution] {
        let list: InstitutionList = try load("institutions.ng")
        return country == .ng ? list.items : []
    }

    func vaultBalance() async throws -> VaultBalance {
        try load("vault.balance")
    }

    func recipients() async throws -> RecipientList {
        try load("recipients.list")
    }

    func recentPeople() async throws -> RecentPeopleList {
        try load("people.recent")
    }

    func person(named name: String) async throws -> Person {
        try load("person.tobi")
    }

    func relay(signedDelegate: String) async throws -> RelayResult {
        try load("relay.failed")
    }

    func relayResult(hash: String) async throws -> RelayResult {
        try load("relay.failed")
    }

    func passkeys() async throws -> PasskeyList {
        try load("passkeys.list")
    }

    func deviceSessions() async throws -> DeviceSessionList {
        try load("sessions.list")
    }

    func revokeSession(id: String) async throws {}

    func createRequest(_ input: PaymentRequestInput, idempotencyKey: String) async throws -> PaymentRequest {
        try load("request.created")
    }

    func request(id: String) async throws -> PaymentRequest {
        try load("request.created")
    }

    func load<Value: Decodable>(_ name: String) throws -> Value {
        try FliqJSON.decoder().decode(Value.self, from: data(name))
    }

    func data(_ name: String) throws -> Data {
        guard let url = bundle.url(forResource: name, withExtension: "json", subdirectory: "fixtures") else {
            throw CocoaError(.fileNoSuchFile, userInfo: [NSFilePathErrorKey: "fixtures/\(name).json"])
        }
        return try Data(contentsOf: url)
    }
}

private actor FixtureLedger {
    private var lastQuoted: TokenAmount?
    private var refunds: Set<String> = []
    private var polls: [String: Int] = [:]
    private var byKey: [String: String] = [:]

    func quoted(_ amount: TokenAmount) {
        lastQuoted = amount
    }

    /// The same Idempotency-Key always returns the same payout, as the real API must.
    func open(idempotencyKey: String) -> String {
        if let existing = byKey[idempotencyKey] { return existing }
        let id = "po_" + UUID().uuidString.prefix(8).lowercased()
        byKey[idempotencyKey] = id
        if lastQuoted == FixtureClient.refundDemoAmount { refunds.insert(id) }
        return id
    }

    func poll(_ id: String) -> (step: Int, refunds: Bool) {
        let step = (polls[id] ?? 0) + 1
        polls[id] = step
        return (step, refunds.contains(id))
    }
}

private extension User {
    func named(_ account: String) -> User {
        User(userId: userId, nearAccount: account, displayName: displayName, occupation: occupation, vault: vault, photoUrl: photoUrl)
    }

    func photographed(_ url: URL) -> User {
        User(userId: userId, nearAccount: nearAccount, displayName: displayName, occupation: occupation, vault: vault, photoUrl: url.absoluteString)
    }
}

private extension Payout {
    func with(id: String) -> Payout {
        copy(payoutId: id)
    }

    /// The settled fixture's first three steps, then the provider fails and the vault refunds.
    func refundedPath() -> Payout {
        var steps = Array(history.prefix(3))
        if let last = steps.last {
            steps.append(StateChange(state: .refunded, at: last.at.addingTimeInterval(19)))
        }
        return copy(state: .refunded, history: steps)
    }

    func upTo(step: Int) -> Payout {
        let reached = Array(history.prefix(step + 1))
        let state = reached.last?.state ?? state
        let settled = state == .settled
        return copy(
            state: state,
            providerOrder: step >= 2 ? providerOrder : nil,
            vaultReceipt: step >= 1 ? vaultReceipt : nil,
            bankReference: settled ? bankReference : nil,
            seconds: settled ? seconds : nil,
            history: reached
        )
    }

    func copy(
        payoutId: String? = nil,
        state: PayoutState? = nil,
        providerOrder: String?? = .none,
        vaultReceipt: String?? = .none,
        bankReference: String?? = .none,
        seconds: Int?? = .none,
        history: [StateChange]? = nil
    ) -> Payout {
        Payout(
            payoutId: payoutId ?? self.payoutId, state: state ?? self.state,
            accountName: accountName, account: account, amount: amount, receive: receive,
            currency: currency, rate: rate, fees: fees, provider: provider, deposit: deposit,
            providerOrder: providerOrder ?? self.providerOrder,
            vaultReceipt: vaultReceipt ?? self.vaultReceipt,
            bankReference: bankReference ?? self.bankReference,
            seconds: seconds ?? self.seconds,
            history: history ?? self.history
        )
    }
}
