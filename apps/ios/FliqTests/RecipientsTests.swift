import XCTest
@testable import Fliq

/// Recipients, swiped in from Home: who shows, in what order, and when the swipe opens or snaps back.
@MainActor
final class RecipientsTests: XCTestCase {
    private let day: TimeInterval = 86_400
    private let start = Date(timeIntervalSince1970: 1_793_000_000)

    private func account(_ name: String, bank: String = "058", number: String, institution: String = "GTBank", id: String? = nil) -> VerifiedAccount {
        VerifiedAccount(bank: bank, number: number, accountName: name, institution: institution, country: .ng, recipientId: id)
    }

    private func person(_ name: String, paid: Date? = nil) -> RecentPerson {
        RecentPerson(nearAccount: name + FliqName.suffix, displayName: name.capitalized, photoUrl: nil, memberSince: start, lastPaidAt: paid)
    }

    private func paidBank(_ code: String, _ last4: String, daysAgo: Double) -> RecentRecipients.Payment {
        RecentRecipients.Payment(to: .bank(code: code, last4: last4), at: start.addingTimeInterval(-daysAgo * day))
    }

    // MARK: Ordering and merging

    func testTheMostRecentlyPaidComeFirstAcrossBanksAndPeople() {
        let sarah = account("SARAH BELLO", number: "0123454821")
        let dara = account("DARA OKONKWO", bank: "044", number: "••••6789", institution: "Access Bank")
        let tobi = person("tobi", paid: start.addingTimeInterval(-2 * day))

        let merged = RecentRecipients.merge(
            accounts: [sarah, dara],
            people: [tobi],
            payments: [paidBank("044", "6789", daysAgo: 1), paidBank("058", "4821", daysAgo: 3)]
        )

        XCTAssertEqual(merged.map(\.name), ["Dara Okonkwo", "Tobi", "Sarah Bello"])
    }

    func testThoseNeverPaidFollowInTheOrderGiven() {
        let paid = account("ADA EZE", number: "0000001111")
        let first = account("BOLA ADE", number: "0000002222")
        let second = account("CHI OBI", number: "0000003333")

        let merged = RecentRecipients.merge(accounts: [first, second, paid], people: [person("zee")], payments: [paidBank("058", "1111", daysAgo: 5)])

        XCTAssertEqual(merged.map(\.name), ["Ada Eze", "Bola Ade", "Chi Obi", "Zee"])
        XCTAssertNil(merged[1].lastPaid)
    }

    func testTheNewestPaymentToTheSameAccountWins() {
        let sarah = account("SARAH BELLO", number: "0123454821")
        let tobi = person("tobi", paid: start.addingTimeInterval(-2 * day))

        let merged = RecentRecipients.merge(
            accounts: [sarah],
            people: [tobi],
            payments: [paidBank("058", "4821", daysAgo: 9), paidBank("058", "4821", daysAgo: 1)]
        )

        XCTAssertEqual(merged.first?.name, "Sarah Bello")
        XCTAssertEqual(merged.first?.lastPaid, start.addingTimeInterval(-day))
    }

    func testAPersonsLatestTransferBeatsAnOlderLastPaidDate() {
        let tobi = person("tobi", paid: start.addingTimeInterval(-10 * day))
        let ada = person("ada", paid: start.addingTimeInterval(-5 * day))
        let transfer = RecentRecipients.Payment(to: .person(nearAccount: tobi.nearAccount), at: start)

        let merged = RecentRecipients.merge(accounts: [], people: [ada, tobi], payments: [transfer])

        XCTAssertEqual(merged.map(\.name), ["Tobi", "Ada"])
    }

    func testTheSameAccountOrPersonShowsOnce() {
        let full = account("SARAH BELLO", number: "0123454821", id: "rcp_1")
        let restored = account("SARAH BELLO", number: "••••4821", id: "rcp_1")
        let tobi = person("tobi")

        let merged = RecentRecipients.merge(accounts: [full, restored], people: [tobi, tobi], payments: [])

        XCTAssertEqual(merged.count, 2)
    }

    func testAPaymentToAnotherBankWithTheSameLastDigitsDoesNotCount() {
        let sarah = account("SARAH BELLO", number: "0123454821")

        let merged = RecentRecipients.merge(accounts: [sarah], people: [], payments: [paidBank("044", "4821", daysAgo: 1)])

        XCTAssertNil(merged.first?.lastPaid)
    }

    func testHistoryGivesPayoutsAndTransfersButNotRefusals() async throws {
        let history = try await FixtureClient().activity().items
        let payments = RecentRecipients.payments(entries: [], history: history)

        let refusals = history.filter { $0.kind == .refused }.count
        XCTAssertGreaterThan(refusals, 0)
        XCTAssertTrue(payments.contains(RecentRecipients.Payment(to: .bank(code: "058", last4: "6789"), at: try XCTUnwrap(history.first?.at))))
        XCTAssertEqual(payments.count, history.filter { $0.kind == .payout || ($0.kind == .transferOut && $0.party.nearAccount != nil) }.count)
    }

    func testRowsSayWhoAndWhereForVoiceOver() {
        let sarah = RecentRecipient(kind: .bank(account("SARAH BELLO", number: "0123454821")), lastPaid: nil)
        let tobi = RecentRecipient(kind: .person(person("tobi")), lastPaid: nil)

        XCTAssertEqual(sarah.accessibilityLabel, "Pay Sarah Bello, GTBank 4821")
        XCTAssertEqual(tobi.detail, "@tobi")
        XCTAssertEqual(sarah.firstName, "Sarah")
    }

    func testSearchMatchesNameBankDigitsAndFliqName() {
        let sarah = RecentRecipient(kind: .bank(account("SARAH BELLO", number: "0123454821")), lastPaid: nil)
        let tobi = RecentRecipient(kind: .person(person("tobi")), lastPaid: nil)

        XCTAssertTrue(sarah.matches("gtb"))
        XCTAssertTrue(sarah.matches("4821"))
        XCTAssertTrue(sarah.matches(" "))
        XCTAssertFalse(sarah.matches("tobi"))
        XCTAssertTrue(tobi.matches("@tob"))
    }

    // MARK: The swipe

    private let width: CGFloat = 400

    func testAClearlyHorizontalDragIsASwipeAndADiagonalOneIsAScroll() {
        XCTAssertEqual(SwipeReveal.axis(of: CGSize(width: -30, height: 5)), .horizontal)
        XCTAssertEqual(SwipeReveal.axis(of: CGSize(width: -20, height: 18)), .vertical)
        XCTAssertEqual(SwipeReveal.axis(of: CGSize(width: 2, height: -40)), .vertical)
    }

    func testTheDirectionIsDecidedOnceForTheWholeDrag() {
        let scrolling = SwipeReveal.track(nil, translation: CGSize(width: 0, height: 20), width: width, isOpen: false)
        let later = SwipeReveal.track(scrolling, translation: CGSize(width: -300, height: 20), width: width, isOpen: false)

        XCTAssertEqual(later.axis, .vertical)
        XCTAssertEqual(later.progress, 0)
        XCTAssertFalse(later.settlesOpen(velocity: -2000))
    }

    func testThePageFollowsTheFingerAndStaysInBounds() {
        let first = SwipeReveal.track(nil, translation: CGSize(width: -20, height: 0), width: width, isOpen: false)
        XCTAssertEqual(SwipeReveal.track(first, translation: CGSize(width: -100, height: 0), width: width, isOpen: false).progress, 0.25)
        XCTAssertEqual(SwipeReveal.track(first, translation: CGSize(width: -900, height: 0), width: width, isOpen: false).progress, 1)
        XCTAssertEqual(SwipeReveal.track(first, translation: CGSize(width: 200, height: 0), width: width, isOpen: false).progress, 0)
    }

    func testOpensPastAThirdAndSnapsBackShortOfIt() {
        let short = SwipeReveal.track(nil, translation: CGSize(width: -120, height: 0), width: width, isOpen: false)
        let far = SwipeReveal.track(nil, translation: CGSize(width: -150, height: 0), width: width, isOpen: false)

        XCTAssertFalse(short.settlesOpen(velocity: -100))
        XCTAssertTrue(far.settlesOpen(velocity: -100))
    }

    func testAFastFlickOpensEvenWhenShort() {
        let flick = SwipeReveal.track(nil, translation: CGSize(width: -40, height: 0), width: width, isOpen: false)

        XCTAssertTrue(flick.settlesOpen(velocity: -900))
    }

    func testAFlickBackTowardHomeWinsOverDistance() {
        let pulledFar = SwipeReveal.track(nil, translation: CGSize(width: -300, height: 0), width: width, isOpen: false)

        XCTAssertFalse(pulledFar.settlesOpen(velocity: 900))
    }

    func testSwipingBackClosesAndAShortNudgeStaysOpen() {
        let nudge = SwipeReveal.track(nil, translation: CGSize(width: 80, height: 0), width: width, isOpen: true)
        let back = SwipeReveal.track(nil, translation: CGSize(width: 200, height: 0), width: width, isOpen: true)

        XCTAssertEqual(nudge.progress, 0.8)
        XCTAssertTrue(nudge.settlesOpen(velocity: 0))
        XCTAssertFalse(back.settlesOpen(velocity: 0))
        XCTAssertFalse(nudge.settlesOpen(velocity: 900))
    }

    func testAScrollWhileOpenLeavesItOpen() {
        let scroll = SwipeReveal.track(nil, translation: CGSize(width: 10, height: 60), width: width, isOpen: true)

        XCTAssertEqual(scroll.progress, 1)
        XCTAssertTrue(scroll.settlesOpen(velocity: 2000))
    }
}
