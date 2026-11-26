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
    /// Accounts "saved on the server", kept in memory for as long as this client lives.
    let savedRecipients = FixtureRecipients()

    func saveRecipient(_ input: RecipientInput) async throws -> Recipient { await savedRecipients.save(input) }

    func markOwnRecipient(id: String) async throws { await savedRecipients.markOwn(id) }

    func deleteRecipient(id: String) async throws { await savedRecipients.delete(id) }

    /// Wallets "saved on the server": the fixture list at first, then whatever this client saved, renamed or removed.
    let savedWallets = FixtureWallets()

    func wallets() async throws -> SavedWalletList {
        SavedWalletList(items: await savedWallets.list(seed: (try? load("wallets.list") as SavedWalletList)?.items ?? []))
    }

    func saveWallet(_ input: SavedWalletInput) async throws -> SavedWallet { try await savedWallets.save(input) }

    func renameWallet(id: String, label: String) async throws -> SavedWallet { try await savedWallets.rename(id, to: label) }

    func deleteWallet(id: String) async throws { await savedWallets.delete(id) }

    /// Notification choices "saved on the server", for tests of what survives a reinstall.
    let savedNotifications = FixtureNotifications()

    func notificationSettings() async throws -> NotificationSettings { await savedNotifications.settings }

    func updateNotificationSettings(_ settings: NotificationSettings) async throws -> NotificationSettings {
        if await savedNotifications.offline { throw URLError(.notConnectedToInternet) }
        return await savedNotifications.save(settings)
    }

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

    func activity() async throws -> ActivityList {
        try load("activity.list")
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

    func removeProfilePhoto() async throws -> User {
        try load("user.new")
    }

    func institutions(in country: Country) async throws -> [Institution] {
        let list: InstitutionList = try load("institutions.ng")
        return country == .ng ? list.items : []
    }

    func vaultBalance() async throws -> VaultBalance {
        try load("vault.balance")
    }

    /// The accounts saved through this client, as the server would list them.
    func recipients() async throws -> RecipientList {
        RecipientList(items: await savedRecipients.list())
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

/// The server's saved accounts, for tests of what survives a reinstall. Lists show only the last four digits.
actor FixtureRecipients {
    private(set) var items: [Recipient] = []
    private(set) var numbers: [String: String] = [:]

    func list() -> [Recipient] { items }

    func save(_ input: RecipientInput) -> Recipient {
        if let found = items.first(where: { $0.bank.code == input.bank && numbers[$0.recipientId] == input.number }) { return found }
        let recipient = Recipient(
            recipientId: "rcp_\(items.count + 1)", accountName: "DARA OKONKWO",
            bank: .init(code: input.bank, name: input.bank == "058" ? "GTBank" : input.bank, logoKey: nil),
            accountLast4: String(input.number.suffix(4)), createdAt: .now, country: input.country, own: false
        )
        items.append(recipient)
        numbers[recipient.recipientId] = input.number
        return recipient
    }

    func markOwn(_ id: String) {
        items = items.map { item in
            var item = item
            item.own = item.recipientId == id
            return item
        }
    }

    func delete(_ id: String) { items.removeAll { $0.recipientId == id } }
}

/// The server's saved wallets, checked as the API checks them. A second save of the same address renames it.
actor FixtureWallets {
    private var items: [SavedWallet]?
    private var count = 0

    func list(seed: [SavedWallet]) -> [SavedWallet] {
        if items == nil { items = seed }
        return items ?? []
    }

    func save(_ input: SavedWalletInput) throws -> SavedWallet {
        guard let chain = WalletChain(rawValue: input.chain), WalletAddress.problem(input.address, on: chain) == nil else {
            throw APIError.server(status: 400, .init(code: "invalid_request", message: "That is not a \(WalletChain(rawValue: input.chain)?.name ?? input.chain) address. Check it and try again."))
        }
        var all = items ?? []
        if let index = all.firstIndex(where: { $0.isSame(chain: input.chain, address: input.address) }) {
            all[index].label = input.label
            items = all
            return all[index]
        }
        count += 1
        let wallet = SavedWallet(walletId: "wal_local_\(count)", label: input.label, chain: input.chain, address: input.address, token: input.token, createdAt: .now)
        items = all + [wallet]
        return wallet
    }

    func rename(_ id: String, to label: String) throws -> SavedWallet {
        guard var all = items, let index = all.firstIndex(where: { $0.walletId == id }) else { throw APIError.unexpected(status: 404) }
        all[index].label = label
        items = all
        return all[index]
    }

    func delete(_ id: String) { items?.removeAll { $0.walletId == id } }
}

/// Starts as a new user's settings on the server: money and agent notices on, rates off.
actor FixtureNotifications {
    private(set) var settings = NotificationSettings(
        received: true, payoutPaid: true, payoutRefunded: true, agentPaid: true, agentRefused: true, capAlmostReached: true,
        rateAlert: .init(enabled: false, currency: "NGN", above: nil), weeklySummary: false
    )

    func preset(_ new: NotificationSettings) { settings = new }
    /// While true, saves fail as they would with no signal.
    private(set) var offline = false
    func setOffline(_ value: Bool) { offline = value }
    private(set) var saves = 0

    func save(_ new: NotificationSettings) -> NotificationSettings {
        settings = new
        saves += 1
        return new
    }
}
