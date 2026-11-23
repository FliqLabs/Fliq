import XCTest
@testable import Fliq

final class BankSearchTests: XCTestCase {
    private let banks = [
        Institution(code: "058", name: "GTBank"),
        Institution(code: "044", name: "Access Bank"),
        Institution(code: "999992", name: "OPay"),
        Institution(code: "50515", name: "Moniepoint MFB"),
        Institution(code: "070", name: "Fidelity Bank"),
    ]

    func testTypingNarrowsTheListByAnyPartOfTheName() {
        XCTAssertEqual(BankSearchSheet.matches(banks, query: "moni").map(\.name), ["Moniepoint MFB"])
        XCTAssertEqual(BankSearchSheet.matches(banks, query: "BANK").map(\.name), ["GTBank", "Access Bank", "Fidelity Bank"], "Case does not matter")
        XCTAssertEqual(BankSearchSheet.matches(banks, query: "fid bank").map(\.name), ["Fidelity Bank"], "Every word must match")
        XCTAssertEqual(BankSearchSheet.matches(banks, query: "058").map(\.name), ["GTBank"], "A bank code works too")
    }

    func testAnEmptySearchShowsEverything() {
        XCTAssertEqual(BankSearchSheet.matches(banks, query: "  ").count, banks.count)
        XCTAssertTrue(BankSearchSheet.matches(banks, query: "zzz").isEmpty)
    }
}
