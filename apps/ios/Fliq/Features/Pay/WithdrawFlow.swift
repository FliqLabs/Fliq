import Foundation
import Observation
import Security

/// Sending dollars from the vault to a wallet outside fliq: pick the network, paste an address, type dollars, sign once.
/// To NEAR it is a direct transfer. To another network the same signed transfer goes to a NEAR Intents address, which
/// delivers it there.
@MainActor
@Observable
final class WithdrawFlow {
    static let checkDelay: Duration = .milliseconds(400)

    struct Sent: Equatable {
        let amount: TokenAmount
        let address: String
        var explorer: URL?
        /// False from Face ID until the USDC has reached the wallet, on whichever network it is.
        var delivered = false
        var at = Date.now
        var network = SendNetwork.near
        /// What the wallet gets after the network fee. The same as `amount` on NEAR.
        var receives: TokenAmount?
        var fee: TokenAmount?
        /// True once the USDC has left the user's account on NEAR and is crossing to the other network.
        var crossing = false
        /// Set when the other network could not take it: the money is back in the user's own account.
        var returned = false
    }

    var addressText = "" {
        didSet { if addressText != oldValue { check = nil; errorMessage = nil; quote = nil } }
    }
    /// NEAR first, then whatever the API offers. The picked one decides how the address is read and how it is sent.
    private(set) var networks: [SendNetwork] = [.near]
    var network = SendNetwork.near {
        didSet { if network != oldValue { check = nil; errorMessage = nil; quote = nil } }
    }
    /// The quote for a send to another network: what arrives, the fee, and where on NEAR to send it.
    private(set) var quote: WalletSend?
    private(set) var isQuoting = false
    private struct QuoteRequest: Equatable {
        let chain: String
        let address: String
        let amount: String
    }
    @ObservationIgnored private var quoting: (request: QuoteRequest, task: Task<WalletSend, Error>)?
    private(set) var check: AddressCheck?
    private(set) var isChecking = false
    private(set) var amountText = ""
    private(set) var isSending = false
    private(set) var errorMessage: String?
    private(set) var sent: Sent?
    private var prepared: PreparedWithdraw?

    private(set) var recentAddresses: [SentAddresses.Entry]
    /// True when the send started from a saved wallet: the address is known, so Next goes from the amount to Review.
    private(set) var startedFromWallet = false
    /// After a send to an address that has no name yet, the app offers to save it once.
    private(set) var offersToSave = false

    private let withdrawals: any Withdrawals
    private let sends: any SendsAPI
    private let vault: VaultStore?
    private let near: NearNetwork
    var pollInterval: Duration = .seconds(3)
    var pollAttempts = 60
    private let recents: SentAddresses
    private let wallets: WalletBook?
    private let onLeftVault: () async -> Void
    let signing: SigningAccess

    init(
        withdrawals: any Withdrawals,
        sends: any SendsAPI = FixtureSendsAPI(),
        vault: VaultStore? = nil,
        network: NearNetwork = .testnet,
        recents: SentAddresses = SentAddresses(),
        wallets: WalletBook? = nil,
        recovery: (any AccountRecovering)? = nil,
        onLeftVault: @escaping () async -> Void = {}
    ) {
        signing = SigningAccess(recovery: recovery)
        self.withdrawals = withdrawals
        self.sends = sends
        self.vault = vault
        near = network
        self.recents = recents
        self.wallets = wallets
        self.onLeftVault = onLeftVault
        recentAddresses = recents.entries()
    }

    /// NEAR names are lower case. Addresses on other networks are kept exactly as typed: on Solana case matters.
    var address: String {
        network.isNEAR ? WithdrawAddress.normalized(addressText) : addressText.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    var amount: TokenAmount? { TokenAmount(decimalString: amountText) }
    var available: TokenAmount { vault?.balance ?? .zero }


    var isOverBalance: Bool {
        guard let vault, let amount else { return false }
        return amount > vault.balance
    }

    var hasAmount: Bool {
        guard let amount, amount > .zero else { return false }
        return !isOverBalance && !signing.isBlocked
    }

    /// Another network takes a small fee, so a send below its minimum would mostly be eaten by it.
    var isBelowMinimum: Bool { isBelowMinimum(for: network) }

    func isBelowMinimum(for network: SendNetwork) -> Bool {
        guard !network.isNEAR, let amount else { return false }
        return amount < network.minimumAmount
    }

    /// Said on the Send to screen, before an address is typed, so a send too small for its network never starts.
    var minimumNote: String? {
        guard isBelowMinimum else { return nil }
        return "The smallest amount you can send to \(network.name) is $\(Money.dollars(network.minimumAmount)). Go back to change the amount, or pick another network."
    }

    var hasAddress: Bool {
        if case .ready = check { true } else { false }
    }

    var canSend: Bool { hasAmount && hasAddress && !isSending && !isBelowMinimum && (network.isNEAR || quote != nil) }

    func loadNetworks() async {
        guard networks.count == 1, let offered = try? await sends.networks() else { return }
        networks = [.near] + offered.filter(\.available)
    }

    func pick(_ address: String) {
        addressText = address
    }

    /// Saved wallets, most recently sent to first, shown by name above the Recent list.
    var savedWallets: [SavedWallet] { wallets?.saved ?? [] }

    /// Recent NEAR wallets that have not been saved under a name.
    var unsavedRecents: [SentAddresses.Entry] {
        recentAddresses.filter { wallets?.wallet(chain: WalletChain.near.rawValue, address: $0.address) == nil }
    }

    /// Fills in a saved wallet's network and address and checks it, as if the user had picked them on Send to.
    func use(_ wallet: SavedWallet) async {
        if wallet.chain != network.chain {
            if wallet.chain != SendNetwork.near.chain, !networks.contains(where: { $0.chain == wallet.chain }) { await loadNetworks() }
            guard let picked = networks.first(where: { $0.chain == wallet.chain }) else {
                errorMessage = "Sending to \(wallet.network?.name ?? wallet.chain) isn't available right now."
                return
            }
            network = picked
        }
        addressText = wallet.address
        await checkAddress()
    }

    func startFromWallet(_ wallet: SavedWallet) async {
        startedFromWallet = true
        await use(wallet)
    }

    /// Nil when it was saved, otherwise what to tell the user.
    func saveSentWallet(named label: String) async -> String? {
        guard let wallets, let sent else { return nil }
        if let problem = WalletAddress.labelProblem(label) { return problem.isEmpty ? "Give it a name." : problem }
        let input = SavedWalletInput(label: label.trimmingCharacters(in: .whitespacesAndNewlines), chain: sent.network.chain, address: sent.address, token: sent.network.token)
        do {
            try await wallets.save(input)
            wallets.markSent(chain: input.chain, address: input.address, at: sent.at)
            offersToSave = false
            return nil
        } catch {
            return WalletSaveError.message(error)
        }
    }

    func skipSaving() {
        offersToSave = false
    }

    private func sentTo(_ address: String) {
        wallets?.markSent(chain: network.chain, address: address)
        offersToSave = wallets.map { $0.wallet(chain: network.chain, address: address) == nil } ?? false
    }

    @discardableResult
    func enterAmount(_ typed: String) -> String {
        amountText = AmountTyping.clean(typed, previous: amountText)
        errorMessage = nil
        return amountText
    }

    /// Everything in the vault down to the cent. Rounding up could ask for more than the vault holds.
    func useEverything() {
        amountText = Self.cents(available)
        errorMessage = nil
    }

    /// Dollars with exactly two decimals, rounded down.
    static func cents(_ amount: TokenAmount) -> String {
        let cents = amount.baseUnits / (TokenAmount.base / 100)
        return "\(cents / 100)." + String(format: "%02lld", cents % 100)
    }

    /// Runs after typing pauses. The view calls it with `task(id: addressText)`, so a newer keystroke cancels it.
    func checkAddress() async {
        let address = address
        guard !address.isEmpty, check == nil else { return }
        // Other networks need no lookup: the shape of the address is all that can be checked.
        guard network.isNEAR else {
            check = SendAddress.problem(address, on: network).map(AddressCheck.invalid) ?? .ready(needsSetup: false)
            return
        }
        try? await Task.sleep(for: Self.checkDelay)
        guard !Task.isCancelled else { return }
        isChecking = true
        defer { isChecking = false }
        let result = await withdrawals.check(address)
        guard !Task.isCancelled, self.address == address else { return }
        check = result
    }

    /// Reads what the send needs while Review is on screen, so the Face ID tap goes straight to Face ID.
    func prepare() async {
        guard let amount, hasAmount, hasAddress, !isSending, !isBelowMinimum else { return }
        guard let target = await target(for: amount) else { return }
        if let prepared, prepared.isFresh(for: amount, to: target) { return }
        prepared = try? await withdrawals.prepare(amount, to: target)
    }

    /// Where on NEAR the USDC goes: the wallet itself, or for another network the address NEAR Intents gave for this send.
    private func target(for amount: TokenAmount) async -> String? {
        guard !network.isNEAR else { return address }
        if let quote, quote.to == address, quote.chain == network.chain, quote.amount == amount.decimalString, quote.deposit.expiresAt > .now.addingTimeInterval(60) {
            return quote.deposit.address
        }
        // Review can ask several times before the first answer lands. They all share one request and one key,
        // so the API makes one quote.
        let request = QuoteRequest(chain: network.chain, address: address, amount: amount.decimalString)
        if quoting?.request != request {
            let sends = sends
            let key = UUID().uuidString
            quoting = (request, Task { try await sends.start(chain: request.chain, address: request.address, amount: amount, idempotencyKey: key) })
        }
        guard let pending = quoting?.task else { return nil }
        isQuoting = true
        defer { isQuoting = false }
        do {
            let fresh = try await pending.value
            if quoting?.request == request { quoting = nil }
            guard request == QuoteRequest(chain: network.chain, address: address, amount: amount.decimalString) else { return nil }
            quote = fresh
            errorMessage = nil
            return fresh.deposit.address
        } catch APIError.server(_, let detail) {
            if quoting?.request == request { quoting = nil }
            quote = nil
            errorMessage = detail.message
        } catch {
            if quoting?.request == request { quoting = nil }
            quote = nil
            errorMessage = "Couldn't get the fee for \(network.name). Check your connection and try again."
        }
        return nil
    }

    func send() async -> Bool {
        guard canSend, let amount else { return false }
        isSending = true
        defer { isSending = false }
        guard let target = await target(for: amount) else { return false }
        let crossing = network.isNEAR ? nil : quote
        do {
            let ready = if let prepared, prepared.isFresh(for: amount, to: target) { prepared } else { try await withdrawals.prepare(amount, to: target) }
            prepared = nil
            let signed = try withdrawals.sign(ready)
            sent = Sent(amount: amount, address: address, network: network, receives: crossing?.receivesAmount, fee: crossing?.feeAmount)
            let receipt = try await withdrawals.deliver(signed)
            vault?.debit(amount)
            errorMessage = nil
            if let crossing {
                // The money has left NEAR. The screen says so and lets the user go; it is followed in the background.
                sent?.crossing = true
                quote = nil
                showLive(crossing, state: .awaiting, amount: amount)
                sentTo(crossing.to)
                await onLeftVault()
                Task { await follow(crossing) }
                return true
            }
            recents.record(address)
            recentAddresses = recents.entries()
            sentTo(address)
            sent?.delivered = true
            sent?.explorer = receipt.transactionHash.isEmpty ? nil : near.explorer(transaction: receipt.transactionHash)
            await onLeftVault()
            return true
        } catch let error as WithdrawError {
            sent = nil
            await explain(error, amount: amount)
        } catch {
            sent = nil
            if let failure = SignFailure(error) {
                errorMessage = failure.message
                if failure == .notAdded { await signing.notAdded() }
            } else {
                errorMessage = SignFailure.isCancel(error) ? nil : "Couldn't reach NEAR. Nothing moved."
            }
        }
        return false
    }

    /// Watches a send cross to the other network, for as long as the user stays on the screen.
    func follow(_ send: WalletSend) async {
        for _ in 0..<pollAttempts where !Task.isCancelled {
            try? await Task.sleep(for: pollInterval)
            guard let fresh = try? await sends.send(id: send.sendId) else { continue }
            showLive(send, state: fresh.state, amount: sent?.amount ?? TokenAmount(decimalString: send.amount) ?? .zero)
            guard fresh.state.isFinal else { continue }
            if fresh.state == .delivered {
                // Read before writing: `sent` cannot be read inside an assignment to itself.
                let explorer = fresh.destinationTx.flatMap { hash in sent?.network.explorer(transaction: hash) }
                sent?.receives = fresh.receivesAmount
                sent?.explorer = explorer
                sent?.delivered = true
            } else {
                sent?.returned = true
                await onLeftVault()
            }
            return
        }
    }

    /// A send to another network shows on the Lock Screen and in the Dynamic Island until it lands.
    private func showLive(_ send: WalletSend, state: WalletSend.State, amount: TokenAmount) {
        let attributes = MoneyActivityAttributes(
            kind: .send,
            refId: send.sendId,
            amount: "$\(Money.dollars(amount))",
            from: "Vault",
            to: "\(LiveMoney.chainName(send.chain)) ••\(send.to.suffix(4))",
            fromMark: "fliq",
            toMark: send.chain == "near" ? "ChainNEAR" : "Chain" + send.chain.capitalized
        )
        LiveMoney.shared.show(attributes, LiveMoney.send(state, chain: send.chain), final: state.isFinal)
    }

    private func explain(_ error: WithdrawError, amount: TokenAmount) async {
        switch error {
        case .refused(let reason) where reason.contains("INSUFFICIENT") || reason.contains("Insufficient"):
            errorMessage = "Your vault doesn't have enough for this."
        case .refused:
            errorMessage = "The vault didn't send it. Nothing moved."
        case .stillPending:
            errorMessage = "Still confirming on NEAR. Check Activity in a moment before trying again."
        case .invalidAddress(let problem):
            errorMessage = problem
        case .notSetUp:
            errorMessage = "Sign in again to send from your vault."
        case .notDelivered:
            vault?.debit(amount)
            await onLeftVault()
            errorMessage = "$\(Money.dollars(amount)) left your vault but didn't reach that address. It's in your fliq wallet: add it back from Home."
        }
    }
}

/// Wallets this iPhone has sent to, newest first, for the Recent list on Send to.
struct SentAddresses: Sendable {
    struct Entry: Codable, Equatable, Identifiable, Sendable {
        let address: String
        var count: Int
        var lastSent: Date

        var id: String { address }
    }

    private let key = "withdraw.recents"
    nonisolated(unsafe) private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func entries() -> [Entry] {
        guard let data = defaults.data(forKey: key), let saved = try? JSONDecoder().decode([Entry].self, from: data) else { return [] }
        return saved.sorted { $0.lastSent > $1.lastSent }
    }

    func record(_ address: String, at date: Date = .now) {
        var saved = entries()
        if let index = saved.firstIndex(where: { $0.address == address }) {
            saved[index].count += 1
            saved[index].lastSent = date
        } else {
            saved.append(Entry(address: address, count: 1, lastSent: date))
        }
        let kept = Array(saved.sorted { $0.lastSent > $1.lastSent }.prefix(8))
        defaults.set(try? JSONEncoder().encode(kept), forKey: key)
    }
}
