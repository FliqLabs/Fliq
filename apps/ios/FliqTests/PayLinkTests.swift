import XCTest
@testable import Fliq

final class PayLinkTests: XCTestCase {
    func testTheWebButtonAndTheSharedLinksAllOpen() {
        let expected = PayLink(name: "olien", code: "k3x9Qa")
        XCTAssertEqual(PayLink(URL(string: "fliq://pay/olien/k3x9Qa")!), expected)
        XCTAssertEqual(PayLink(URL(string: "fliq://pay/OLIEN/k3x9Qa")!), expected, "Names are lower case")
        XCTAssertEqual(PayLink(URL(string: "https://pay.fliq.money/olien/k3x9Qa")!), expected)
        XCTAssertEqual(PayLink(URL(string: "https://fliq.cash/pay/olien/k3x9Qa")!), expected)
    }

    func testAnythingElseIsIgnored() {
        for text in ["fliq://", "fliq://pay/olien", "fliq://send/olien/k3x9Qa", "https://evil.example/olien/k3x9Qa",
                     "https://fliq.cash/olien/k3x9Qa", "http://pay.fliq.money/olien/k3x9Qa", "fliq://pay/olien/k3x9Qa/extra",
                     "fliq://pay/ol%20ien/k3x9Qa"] {
            XCTAssertNil(PayLink(URL(string: text)!), text)
        }
    }

    @MainActor
    func testARequestThatCannotBePaidSaysWhy() {
        let open = PublicPayRequest(nearAccount: "ada.fliqaccount.near", displayName: "Ada", amount: "25.00", note: "", state: "open")
        XCTAssertNil(RootView.problem(with: open, me: "olien.fliqaccount.near"))
        XCTAssertEqual(RootView.problem(with: open, me: "ada.fliqaccount.near"), "This is your own request. Send the link to the person paying you.")
        let paid = PublicPayRequest(nearAccount: "ada.fliqaccount.near", displayName: nil, amount: "25.00", note: "", state: "paid")
        XCTAssertEqual(RootView.problem(with: paid, me: nil), "This request has already been paid.")
        let cancelled = PublicPayRequest(nearAccount: "ada.fliqaccount.near", displayName: nil, amount: "25.00", note: "", state: "cancelled")
        XCTAssertEqual(RootView.problem(with: cancelled, me: nil), "This request was cancelled.")
    }
}
