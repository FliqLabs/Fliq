import XCTest
@testable import Fliq

/// Saved wallets: what the server lists and in what order, how an address is shown and checked, and where they show.
@MainActor
final class SavedWalletsTests: XCTestCase {
    private let solana = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
    private let phantom = "4Nd1mYQzvgV8Vr3Z3nYb7pD6T1K9wLx2aRkQeJcUuHsM"
    private let base = "0x76b4c56085ed136a8744d52be956396624a730e8"
    private let tron = "TA4Wt1DUCqz6YegbnsmqsWC5uUfbdBqPxm"
    private let start = Date(timeIntervalSince1970: 1_793_000_000)

    private func recents() -> SentAddresses { SentAddresses(defaults: UserDefaults(suiteName: "saved-wallets-\(UUID().uuidString)")!) }

    private func wallet(_ id: String, chain: String = "solana", address: String? = nil, created: Double, sent: Double? = nil) -> SavedWallet {
        SavedWallet(
            walletId: id, label: id, chain: chain, address: address ?? solana, token: nil,
            createdAt: start.addingTimeInterval(created * 86_400), lastSentAt: sent.map { start.addingTimeInterval($0 * 86_400) }
        )
    }

    // MARK: WalletBook

    func testSyncListsTheFixtureWalletsMostRecentlySentToFirst() async {
        let book = WalletBook(keychain: nil, recents: recents())
        book.connect(FixtureClient())
        await book.sync()
        XCTAssertEqual(book.saved.map(\.label), ["Tunde's Binance", "Kemi on Base", "Ada's Trust Wallet", "My Phantom"])
        XCTAssertEqual(book.saved.first?.lastSentAt, ISO8601DateFormatter().date(from: "2026-11-15T10:00:00Z"))
    }

    func testOrderIsLastSentThenNewestSaved() {
        let ordered = WalletBook.ordered([
            wallet("old-unsent", created: 1),
            wallet("sent-long-ago", created: 2, sent: 3),
            wallet("new-unsent", created: 5),
            wallet("sent-today", created: 0, sent: 20),
        ])
        XCTAssertEqual(ordered.map(\.walletId), ["sent-today", "sent-long-ago", "new-unsent", "old-unsent"])
    }

    func testSavingTheSameAddressTwiceRenamesItAndASendMovesItToTheTop() async throws {
        let book = WalletBook(keychain: nil, recents: recents())
        book.connect(FixtureClient())
        await book.sync()

        let renamed = try await book.save(SavedWalletInput(label: "Kemi", chain: "base", address: base.uppercased().replacingOccurrences(of: "0X", with: "0x")))
        XCTAssertEqual(book.saved.count, 4)
        XCTAssertEqual(renamed.walletId, "wal_01jcwallet00000000000000a4")
        XCTAssertEqual(book.wallet(chain: "base", address: base)?.label, "Kemi")

        book.markSent(chain: "tron", address: tron, at: start.addingTimeInterval(400 * 86_400))
        XCTAssertEqual(book.saved.first?.label, "Ada's Trust Wallet")
    }

    func testRenameAndDeleteAreKeptOnTheServer() async throws {
        let api = FixtureClient()
        let book = WalletBook(keychain: nil, recents: recents())
        book.connect(api)
        await book.sync()
        let phantomWallet = try XCTUnwrap(book.wallet(chain: "solana", address: phantom))

        try await book.rename(phantomWallet, to: "Phantom")
        try await book.remove(try XCTUnwrap(book.wallet(chain: "tron", address: tron)))

        let fresh = WalletBook(keychain: nil, recents: recents())
        fresh.connect(api)
        await fresh.sync()
        XCTAssertEqual(fresh.saved.map(\.label), ["Tunde's Binance", "Kemi on Base", "Phantom"])
    }

    func testARefusedRenamePutsTheOldNameBack() async {
        let book = WalletBook(keychain: nil, recents: recents())
        book.connect(FixtureClient())
        await book.sync()
        let ghost = wallet("wal_gone", created: 0)
        do {
            try await book.rename(ghost, to: "Nope")
            XCTFail("A wallet the server doesn't know can't be renamed")
        } catch {}
        XCTAssertEqual(book.saved.count, 4)
        XCTAssertNil(book.saved.first { $0.label == "Nope" })
    }

    func testNEARWalletsSentBeforeButNotSavedAreOfferedForNaming() async throws {
        let sent = recents()
        sent.record("amaka.near")
        sent.record("tobi.fliq.near")
        let book = WalletBook(keychain: nil, recents: sent)
        book.connect(FixtureClient())
        XCTAssertEqual(book.sentBefore.map(\.address), ["tobi.fliq.near", "amaka.near"])

        try await book.save(SavedWalletInput(label: "Tobi", chain: "near", address: "tobi.fliq.near"))
        XCTAssertEqual(book.sentBefore.map(\.address), ["amaka.near"])
    }

    // MARK: Addresses

    func testAddressesAreShortenedToTheirEnds() {
        XCTAssertEqual(WalletAddress.short(solana, on: "solana"), "7xKX…gAsU")
        XCTAssertEqual(WalletAddress.short(base, on: "base"), "0x76b4…30e8")
        XCTAssertEqual(WalletAddress.short(tron, on: "tron"), "TA4W…qPxm")
        XCTAssertEqual(WalletAddress.short("tobi.fliq.near", on: "near"), "tobi.fliq.near", "A NEAR name is already readable")
        XCTAssertEqual(WalletAddress.short(String(repeating: "a", count: 64), on: "near"), "aaaa…aaaa")
        XCTAssertEqual(WalletAddress.short("short", on: "solana"), "short")
    }

    func testEachNetworkChecksItsOwnAddressShape() {
        XCTAssertNil(WalletAddress.problem(" \(solana) ", on: .solana))
        XCTAssertNil(WalletAddress.problem(base, on: .base))
        XCTAssertNil(WalletAddress.problem(base, on: .bnb))
        XCTAssertNil(WalletAddress.problem(tron, on: .tron))
        XCTAssertNil(WalletAddress.problem("Tobi.Fliq.Near", on: .near))
        XCTAssertEqual(WalletAddress.problem("", on: .solana), "")
        XCTAssertEqual(WalletAddress.problem(base, on: .solana), "That's a Base or Ethereum address. Choose Base above to send it there.")
        XCTAssertEqual(WalletAddress.problem("0x123", on: .base), "That isn't a Base address. It starts with 0x and has 42 characters.")
        XCTAssertEqual(WalletAddress.problem("TA4Wt1DUCqz6YegbnsmqsWC5uUfbdBqPxa", on: .tron), "That Tron address has a typo. Copy it again.")
        XCTAssertEqual(WalletAddress.problem(tron, on: .near), "That's a Tron address. Choose Tron above.")
        XCTAssertEqual(WalletAddress.problem("not a wallet", on: .near), "That isn't a NEAR address.")
        XCTAssertEqual(WalletAddress.problem(solana, on: .near), "That's a Solana address. Choose Solana above.")
        XCTAssertNil(WalletChain.guess("7xK"), "Half an address picks nothing")
        XCTAssertNil(WalletChain.guess("amaka"), "A bare word could be anything")
        XCTAssertEqual(WalletChain.guess(solana), .solana)
    }

    func testTheFormNeedsANameAndAnAddressAndAPastedAddressPicksItsNetwork() {
        var form = WalletForm()
        XCTAssertFalse(form.canSave)
        form.address = tron
        XCTAssertEqual(form.chain, .tron)
        form.label = "  "
        XCTAssertFalse(form.canSave)
        form.label = String(repeating: "a", count: 41)
        XCTAssertEqual(form.labelProblem, "Keep the name to 40 characters.")
        form.label = " Ada's Trust Wallet "
        XCTAssertTrue(form.canSave)
        XCTAssertEqual(form.input, SavedWalletInput(label: "Ada's Trust Wallet", chain: "tron", address: tron, token: "usdt"))

        form.chain = .bnb
        form.address = base
        XCTAssertEqual(form.chain, .bnb, "An 0x address fits Base and BNB Chain, so the picked one stays")
        form.address = "Amaka.near"
        XCTAssertEqual(form.chain, .near)
        XCTAssertEqual(form.input.address, "amaka.near")
    }

    // MARK: Recipients

    func testTheFilterSplitsBanksFromStablecoins() {
        let bank = VerifiedAccount(bank: "058", number: "0123454821", accountName: "SARAH BELLO", institution: "GTBank", country: .ng)
        let person = RecentPerson(nearAccount: "tobi" + FliqName.suffix, displayName: "Tobi", photoUrl: nil, memberSince: start, lastPaidAt: nil)
        let tunde = wallet("Tunde's Binance", created: 0, sent: 3)
        let all = RecentRecipients.merge(accounts: [bank], people: [person], payments: [], wallets: [tunde])

        XCTAssertEqual(all.map(\.name), ["Tunde's Binance", "Sarah Bello", "Tobi"])
        XCTAssertEqual(RecentRecipients.filter(all, by: .all, search: "").count, 3)
        XCTAssertEqual(RecentRecipients.filter(all, by: .banks, search: "").map(\.name), ["Sarah Bello"])
        XCTAssertEqual(RecentRecipients.filter(all, by: .stablecoins, search: "").map(\.name), ["Tunde's Binance"])
        XCTAssertEqual(RecentRecipients.filter(all, by: .all, search: "solana").map(\.name), ["Tunde's Binance"])
        XCTAssertEqual(RecentRecipients.filter(all, by: .stablecoins, search: "gAsU").count, 1)
        XCTAssertEqual(RecentRecipients.Filter.allCases.map(\.title), ["All", "Banks", "Stablecoins"])
    }

    func testAWalletTileShowsItsWholeNameAndShortAddress() {
        let recipient = RecentRecipient(kind: .wallet(wallet("Tunde's Binance", created: 0)), lastPaid: nil)
        XCTAssertEqual(recipient.firstName, "Tunde's Binance")
        XCTAssertEqual(recipient.detail, "7xKX…gAsU")
        XCTAssertEqual(recipient.accessibilityLabel, "Send to Tunde's Binance, Solana wallet ending gAsU")
    }

    // MARK: Send flow

    func testASavedWalletOpensTheSendWithItsNetworkAndAddressFilledIn() async throws {
        let book = WalletBook(keychain: nil, recents: recents())
        book.connect(FixtureClient())
        await book.sync()
        let flow = WithdrawFlow(withdrawals: FixtureWithdrawals(), sends: FixtureSendsAPI(), vault: VaultStore(balance: TokenAmount(baseUnits: 50_000_000)), recents: recents(), wallets: book)

        await flow.startFromWallet(try XCTUnwrap(book.wallet(chain: "tron", address: tron)))

        XCTAssertTrue(flow.startedFromWallet)
        XCTAssertEqual(flow.network.chain, "tron")
        XCTAssertEqual(flow.address, tron)
        XCTAssertTrue(flow.hasAddress)
        XCTAssertEqual(flow.savedWallets.first?.label, "Tunde's Binance")
    }

    func testAfterASendToAnUnsavedAddressTheAppOffersToSaveItOnce() async throws {
        let book = WalletBook(keychain: nil, recents: recents())
        book.connect(FixtureClient())
        await book.sync()
        let flow = WithdrawFlow(withdrawals: FixtureWithdrawals(), sends: FixtureSendsAPI(), vault: VaultStore(balance: TokenAmount(baseUnits: 50_000_000)), recents: recents(), wallets: book)
        flow.pollInterval = .zero
        flow.pollAttempts = 0
        await flow.loadNetworks()
        flow.network = try XCTUnwrap(flow.networks.first { $0.chain == "base" })
        flow.addressText = "0x00000000000000000000000000000000000000a1"
        await flow.checkAddress()
        flow.enterAmount("5")
        await flow.prepare()

        let sent = await flow.send()
        XCTAssertTrue(sent)
        XCTAssertTrue(flow.offersToSave)

        let empty = await flow.saveSentWallet(named: " ")
        XCTAssertEqual(empty, "Give it a name.")
        let saved = await flow.saveSentWallet(named: "Kemi's Coinbase")
        XCTAssertNil(saved)
        XCTAssertFalse(flow.offersToSave)
        XCTAssertEqual(book.saved.first?.label, "Kemi's Coinbase", "It was just sent to, so it leads the list")
        XCTAssertEqual(book.saved.first?.token, "usdc")
    }

    func testNoOfferAfterASendToASavedWallet() async throws {
        let book = WalletBook(keychain: nil, recents: recents())
        book.connect(FixtureClient())
        await book.sync()
        let flow = WithdrawFlow(withdrawals: FixtureWithdrawals(), sends: FixtureSendsAPI(), vault: VaultStore(balance: TokenAmount(baseUnits: 50_000_000)), recents: recents(), wallets: book)
        flow.pollInterval = .zero
        flow.pollAttempts = 0
        await flow.startFromWallet(try XCTUnwrap(book.wallet(chain: "solana", address: phantom)))
        flow.enterAmount("5")
        await flow.prepare()

        let sent = await flow.send()
        XCTAssertTrue(sent)
        XCTAssertFalse(flow.offersToSave)
        XCTAssertEqual(book.saved.first?.label, "My Phantom")
    }
}
