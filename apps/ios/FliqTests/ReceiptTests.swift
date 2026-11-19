import PDFKit
import XCTest
@testable import Fliq

/// The shared receipt is a real one-page PDF or an image, never a block of text.
@MainActor
final class ReceiptTests: XCTestCase {
    private func transfer() throws -> ActivityLine {
        let json = """
        {
          "activity_id": "act_tr_1", "kind": "transfer_out", "status": "sent", "at": "2026-11-19T08:27:00.000Z",
          "party": { "name": "Frank", "near_account": "olien.fliqaccount.near", "institution": null, "account_last4": null, "photo_url": null },
          "provider": null, "agent": null, "local": null, "usd": "1.00", "token": null, "seconds": null,
          "reason": null, "ref_id": "tr_01jbd9a2c4e6", "tx_hash": "8xQ3kfV9n2LmP4rT7yW1zA5bC6dE8fG9hJ2kL3mN4pQ"
        }
        """
        let item = try FliqJSON.decoder().decode(ActivityItem.self, from: Data(json.utf8))
        return ActivityLine(.history(item), institutions: [:])
    }

    func testATransferReceiptLinksToTheTransactionOnNEAR() throws {
        let document = ReceiptDocument(line: try transfer())

        XCTAssertEqual(document.kind, "TRANSFER")
        XCTAssertEqual(document.status, "Completed")
        XCTAssertEqual(document.amountLabel, "Amount sent")
        XCTAssertFalse(document.amount.hasPrefix("-"), "A receipt says how much, not which way: \(document.amount)")
        XCTAssertFalse(document.details.contains { $0.label == "Amount" }, "The amount is the headline already")
        XCTAssertEqual(document.reference, "tr_01jbd9a2c4e6")
        XCTAssertTrue(document.details.contains { $0.label == "NEAR transaction" && $0.value == "8xQ3kfV9n2LmP4rT7yW1zA5bC6dE8fG9hJ2kL3mN4pQ" })
        guard case .explorer(let url, let network) = document.proof else { return XCTFail("A transfer with a hash links to it") }
        XCTAssertEqual(network, "NEAR")
        XCTAssertTrue(url.absoluteString.hasSuffix("/txns/8xQ3kfV9n2LmP4rT7yW1zA5bC6dE8fG9hJ2kL3mN4pQ"))
    }

    func testACashOutReceiptCarriesTheBankSessionID() throws {
        let payout: Payout = try FixtureClient().load("payout.settled")
        let document = ReceiptDocument(payout: payout)

        XCTAssertEqual(document.kind, "CASH OUT")
        XCTAssertEqual(document.reference, payout.payoutId)
        XCTAssertEqual(document.party.first?.value, payout.accountName)
        if let session = payout.bankReference {
            XCTAssertEqual(document.proof, .bank(session))
        }
    }

    func testTheReceiptIsAOnePageA4PDFWithRealText() throws {
        let url = try ReceiptFiles.pdf(ReceiptDocument(line: try transfer()))
        let pdf = try XCTUnwrap(PDFDocument(url: url))

        XCTAssertEqual(url.pathExtension, "pdf")
        XCTAssertEqual(pdf.pageCount, 1)
        let page = try XCTUnwrap(pdf.page(at: 0))
        XCTAssertEqual(page.bounds(for: .mediaBox).size, CGSize(width: 595, height: 842))
        let text = page.string ?? ""
        XCTAssertTrue(text.contains("Proof of payment"), text)
        XCTAssertTrue(text.contains("tr_01jbd9a2c4e6"))
        preview(url)
    }

    func testTheImageIsSharpAndAsTallAsTheReceipt() throws {
        let payout: Payout = try FixtureClient().load("payout.settled")
        let url = try ReceiptFiles.image(ReceiptDocument(payout: payout))
        let image = try XCTUnwrap(UIImage(contentsOfFile: url.path))

        XCTAssertEqual(url.pathExtension, "png")
        XCTAssertEqual(image.size.width * image.scale, 595 * 3, accuracy: 1)
        XCTAssertLessThanOrEqual(image.size.height * image.scale, 842 * 3, "The tallest receipt still fits one A4 page, so the PDF is never cut off")
        preview(url)
        preview(try ReceiptFiles.image(ReceiptDocument(line: try transfer())))
    }

    /// Set TEST_RUNNER_RECEIPT_PREVIEW to a folder to look at the files the tests made.
    private func preview(_ url: URL) {
        guard let folder = ProcessInfo.processInfo.environment["RECEIPT_PREVIEW"] else { return }
        let target = URL(fileURLWithPath: folder).appendingPathComponent(url.lastPathComponent)
        try? FileManager.default.removeItem(at: target)
        try? FileManager.default.copyItem(at: url, to: target)
    }
}
