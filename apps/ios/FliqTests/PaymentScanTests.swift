import XCTest
@testable import Fliq

final class PaymentScanTests: XCTestCase {
    private func tlv(_ tag: String, _ value: String) -> String {
        tag + String(format: "%02d", value.count) + value
    }

    /// A merchant-presented EMV code with its CRC-16/CCITT-FALSE appended, as a printed sticker carries it.
    private func emv(_ fields: [(String, String)]) -> String {
        let body = tlv("00", "01") + tlv("01", "12") + fields.map { tlv($0.0, $0.1) }.joined() + "6304"
        return body + String(format: "%04X", EMVCode.crc16(body))
    }

    private func code(_ payload: String, file: StaticString = #filePath, line: UInt = #line) -> ScannedCode? {
        guard case .code(let code) = PaymentScan.parse(payload) else {
            XCTFail("not a payment code: \(PaymentScan.parse(payload))", file: file, line: line)
            return nil
        }
        return code
    }

    // MARK: TLV and CRC

    func testTheCRCMatchesTheStandardCheckValue() {
        XCTAssertEqual(EMVCode.crc16("123456789"), 0x29B1)
    }

    func testThePixManualExampleReadsWithAValidChecksum() throws {
        let sample = "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D"
        let pix = try XCTUnwrap(code(sample))
        XCTAssertEqual(pix.scheme, .pix)
        XCTAssertEqual(pix.country, "BR")
        XCTAssertEqual(pix.title, "Pix · Brazil")
        XCTAssertEqual(pix.merchant, "Fulano de Tal")
        XCTAssertEqual(pix.city, "BRASILIA")
        XCTAssertEqual(pix.currency, "BRL")
        XCTAssertEqual(pix.payee, "123e4567-e12b-12d1-a456-426655440000")
        XCTAssertNil(pix.account)
        XCTAssertEqual(pix.comingSoon, "Paying in Brazil is coming soon.")
    }

    func testAnAlteredCodeIsDamaged() {
        let sample = emv([("26", tlv("00", "br.gov.bcb.pix") + tlv("01", "fulano@example.com")), ("53", "986"), ("58", "BR"), ("59", "FULANO")])
        let wrongCRC = String(sample.dropLast()) + (sample.hasSuffix("0") ? "1" : "0")
        XCTAssertEqual(PaymentScan.parse(wrongCRC), .damaged)
        XCTAssertEqual(PaymentScan.parse(sample.replacingOccurrences(of: "FULANO", with: "FULANA")), .damaged)
    }

    func testTheWalkerRefusesABrokenLength() {
        XCTAssertNil(EMVCode.walk("0005" + "01"))
        XCTAssertEqual(PaymentScan.parse("000201" + "26ZZ"), .damaged)
    }

    // MARK: Schemes

    func testPromptPay() throws {
        let payload = emv([
            ("29", tlv("00", "A000000677010111") + tlv("01", "0066812345678")),
            ("53", "764"), ("54", "150.00"), ("58", "TH"), ("59", "SOMCHAI"), ("60", "BANGKOK"),
        ])
        let promptPay = try XCTUnwrap(code(payload))
        XCTAssertEqual(promptPay.scheme, .promptPay)
        XCTAssertEqual(promptPay.title, "PromptPay · Thailand")
        XCTAssertEqual(promptPay.payee, "0066812345678")
        XCTAssertEqual(promptPay.currency, "THB")
        XCTAssertEqual(promptPay.amount, Decimal(string: "150.00"))
    }

    func testPayNowWinsOverTheSGQRWrapper() throws {
        let payload = emv([
            ("26", tlv("00", "SG.PAYNOW") + tlv("01", "2") + tlv("02", "201403121W") + tlv("03", "1")),
            ("51", tlv("00", "SG.SGQR") + tlv("01", "180101ABCDEF")),
            ("52", "0000"), ("53", "702"), ("58", "SG"), ("59", "ACME PTE LTD"), ("60", "Singapore"),
        ])
        let payNow = try XCTUnwrap(code(payload))
        XCTAssertEqual(payNow.scheme, .payNow)
        XCTAssertEqual(payNow.payee, "201403121W")
        XCTAssertEqual(payNow.currency, "SGD")
        XCTAssertEqual(payNow.comingSoon, "Paying in Singapore is coming soon.")
    }

    func testDuitNow() throws {
        let payload = emv([("26", tlv("00", "A0000006150001") + tlv("01", "890053") + tlv("02", "MERCHANT123")), ("53", "458"), ("58", "MY"), ("59", "KEDAI ALI")])
        let duitNow = try XCTUnwrap(code(payload))
        XCTAssertEqual(duitNow.scheme, .duitNow)
        XCTAssertEqual(duitNow.title, "DuitNow · Malaysia")
        XCTAssertEqual(duitNow.currency, "MYR")
    }

    func testQRIS() throws {
        let payload = emv([
            ("26", tlv("00", "ID.CO.SHOPEE.WWW") + tlv("01", "936009180000000000")),
            ("51", tlv("00", "ID.CO.QRIS.WWW") + tlv("02", "ID1020000000001")),
            ("53", "360"), ("58", "ID"), ("59", "WARUNG BUDI"), ("60", "JAKARTA"),
        ])
        let qris = try XCTUnwrap(code(payload))
        XCTAssertEqual(qris.scheme, .qris)
        XCTAssertEqual(qris.title, "QRIS · Indonesia")
        XCTAssertEqual(qris.currency, "IDR")
    }

    func testQRPh() throws {
        let payload = emv([("27", tlv("00", "com.p2pqrpay") + tlv("01", "BNORPHMMXXX") + tlv("03", "09171234567")), ("53", "608"), ("58", "PH"), ("59", "JUAN DELA CRUZ"), ("60", "MANILA")])
        let qrPh = try XCTUnwrap(code(payload))
        XCTAssertEqual(qrPh.scheme, .qrPh)
        XCTAssertEqual(qrPh.payee, "09171234567")
        XCTAssertEqual(qrPh.currency, "PHP")
    }

    func testVietQRReadsTheNestedBeneficiary() throws {
        let beneficiary = tlv("00", "970436") + tlv("01", "0011012345678")
        let payload = emv([("38", tlv("00", "A000000727") + tlv("01", beneficiary) + tlv("02", "QRIBFTTA")), ("53", "704"), ("54", "50000"), ("58", "VN")])
        let vietQR = try XCTUnwrap(code(payload))
        XCTAssertEqual(vietQR.scheme, .vietQR)
        XCTAssertEqual(vietQR.title, "VietQR · Vietnam")
        XCTAssertEqual(vietQR.payee, "0011012345678 · bank 970436")
        XCTAssertEqual(vietQR.amount, 50000)
    }

    func testUPI() throws {
        let upi = try XCTUnwrap(code("upi://pay?pa=shop@okicici&pn=Chai%20Point&am=120.50&cu=INR"))
        XCTAssertEqual(upi.scheme, .upi)
        XCTAssertEqual(upi.title, "UPI · India")
        XCTAssertEqual(upi.merchant, "Chai Point")
        XCTAssertEqual(upi.payee, "shop@okicici")
        XCTAssertEqual(upi.amount, Decimal(string: "120.50"))
        XCTAssertEqual(upi.currency, "INR")
        XCTAssertEqual(PaymentScan.parse("upi://pay?pn=NoAddress"), .nothing)
    }

    func testNQRWithAnAccountIsPayable() throws {
        let payload = emv([("26", tlv("00", "ng.com.nibss") + tlv("01", "000013") + tlv("02", "0123456789")), ("53", "566"), ("54", "2500.00"), ("58", "NG"), ("59", "MAMA PUT")])
        let nqr = try XCTUnwrap(code(payload))
        XCTAssertEqual(nqr.scheme, .nqr)
        XCTAssertEqual(nqr.account?.number, "0123456789")
        XCTAssertEqual(nqr.account?.institution.code, "058")
        XCTAssertNil(nqr.comingSoon)
    }

    func testAnOldThreeDigitBankCodeMapsToTheBank() throws {
        let payload = emv([("26", tlv("00", "ng.com.nibss") + tlv("01", "057") + tlv("02", "2034567891")), ("53", "566"), ("58", "NG")])
        XCTAssertEqual(try XCTUnwrap(code(payload)).account?.institution.name, "Zenith Bank")
    }

    func testAnNQRMerchantCodeWithoutAnAccountIsNotFaked() throws {
        let payload = emv([("26", tlv("00", "ng.com.nibss") + tlv("01", "S0000123A")), ("53", "566"), ("58", "NG"), ("59", "MAMA PUT")])
        let nqr = try XCTUnwrap(code(payload))
        XCTAssertNil(nqr.account)
        XCTAssertEqual(nqr.comingSoon, "Paying NQR merchant codes is coming soon.")
    }

    func testAKenyanMPesaNumberIsPayableAndATillIsNot() throws {
        let phone = emv([("29", tlv("00", "KE.SAFARICOM.MPESA") + tlv("01", "254712345678")), ("53", "404"), ("58", "KE"), ("59", "WANJIRU")])
        let send = try XCTUnwrap(code(phone))
        XCTAssertEqual(send.scheme, .mpesa)
        XCTAssertEqual(send.account?.number, "0712345678")
        XCTAssertEqual(send.account?.institution, .mpesa)

        let till = emv([("29", tlv("00", "KE.SAFARICOM.MPESA") + tlv("01", "5123456")), ("53", "404"), ("58", "KE"), ("59", "DUKA")])
        let shop = try XCTUnwrap(code(till))
        XCTAssertNil(shop.account)
        XCTAssertEqual(shop.comingSoon, "Paying M-Pesa tills and paybills is coming soon.")
    }

    func testAnUnknownSchemeStillShowsItsCountry() throws {
        let payload = emv([("30", tlv("00", "XX.SOMEPAY") + tlv("01", "123")), ("53", "840"), ("58", "US"), ("59", "DINER")])
        let other = try XCTUnwrap(code(payload))
        XCTAssertEqual(other.scheme, .emv)
        XCTAssertEqual(other.title, "QR payment · United States")
        XCTAssertEqual(other.flag, "🇺🇸")
    }

    // MARK: Text fallback

    func testTextWithANumberAndABankNameIsPayable() {
        guard case .bank(let number, let institution, _) = PaymentScan.parse("Pay into 0123456789 OPay Frank") else { return XCTFail() }
        XCTAssertEqual(number, "0123456789")
        XCTAssertEqual(institution.code, "999992")
    }

    func testBankNamesMatchByTheirCommonNames() {
        let cases: [(String, String)] = [
            ("GTB 0123456789", "058"),
            ("Acct: 012 345 6789\nGuaranty Trust Bank", "058"),
            ("Moniepoint MFB\n8012345678", "090405"),
            ("UBA 2034567891", "000004"),
            ("palm pay 8031234567", "100033"),
            ("Kuda Bank - 2001234567", "090267"),
        ]
        for (text, code) in cases {
            guard case .bank(_, let institution, _) = PaymentScan.parse(text) else { return XCTFail(text) }
            XCTAssertEqual(institution.code, code, text)
        }
    }

    func testSeveralNumbersAskWhichOne() {
        let result = PaymentScan.parse("0123456789 or 9876543210 at Kuda")
        guard case .choose(let numbers, let institution) = result else { return XCTFail("\(result)") }
        XCTAssertEqual(numbers, ["0123456789", "9876543210"])
        XCTAssertEqual(institution?.code, "090267")
    }

    func testANumberWithNoBankAsksForTheBank() {
        XCTAssertEqual(PaymentScan.parse("0123456789"), .numberOnly("0123456789"))
    }

    func testAPhoneNumberIsNotAnAccount() {
        XCTAssertEqual(PaymentScan.parse("Call 08012345678 OPay"), .nothing)
    }

    func testFliqLinksAndNamesGoToAFliqPayment() {
        XCTAssertEqual(PaymentScan.parse("https://fliq.cash/pay/olienn/bdec"), .fliqName("olienn"))
        XCTAssertEqual(PaymentScan.parse("olienn" + FliqName.suffix), .fliqName("olienn"))
    }

    func testAnythingElseFindsNothing() {
        XCTAssertEqual(PaymentScan.parse("hello world"), .nothing)
        XCTAssertEqual(PaymentScan.parse("https://example.com/menu"), .nothing)
        XCTAssertEqual(PaymentScan.parse("   "), .nothing)
    }
}

@MainActor
final class ScanToPayTests: XCTestCase {
    private func waitFor(_ condition: () -> Bool) async throws {
        for _ in 0..<100 where !condition() { try await Task.sleep(for: .milliseconds(20)) }
    }

    func testAScannedAccountIsConfirmedAndPrefillsThePayment() async throws {
        let model = ScanToPayModel(api: FixtureClient())
        model.scanned(code: "GTBank 0123456789")
        XCTAssertFalse(model.isScanning)

        try await waitFor { model.entry.verified != nil }
        let verified = try XCTUnwrap(model.entry.verified)
        XCTAssertEqual(verified.number, "0123456789")

        let flow = PayFlow(api: FixtureClient())
        flow.recipient.use(verified)
        XCTAssertEqual(flow.verified, verified)
        XCTAssertEqual(flow.recipient.institution.code, "058")
    }

    func testAnNQRCodeWithAnAmountShowsItsCostInUSDC() async throws {
        let account = "0012ng.com.nibss" + "0106000013" + "02100123456789"
        let body = "000201010212" + "26\(account.count)" + account + "5303566" + "540813700.00" + "5802NG5908MAMA PUT6304"
        let model = ScanToPayModel(api: FixtureClient())
        model.scanned(code: body + String(format: "%04X", EMVCode.crc16(body)))

        guard case .code(let code) = model.result else { return XCTFail("\(String(describing: model.result))") }
        XCTAssertEqual(code.amount, 13700)
        try await waitFor { model.estimate != nil && model.entry.verified != nil }
        XCTAssertNotNil(model.estimate)
        XCTAssertNotNil(model.entry.verified)
    }

    func testAnMPesaCodeSwitchesTheAccountToKenya() async throws {
        let template = "0018KE.SAFARICOM.MPESA" + "0112254712345678"
        let body = "000201010212" + "29\(template.count)" + template + "53034045802KE6304"
        let model = ScanToPayModel(api: FixtureClient())
        model.scanned(code: body + String(format: "%04X", EMVCode.crc16(body)))

        try await waitFor { model.entry.verified != nil }
        XCTAssertEqual(model.entry.country, .ke)
        XCTAssertEqual(model.entry.number, "0712345678")
    }

    func testTextWithoutABankOffersTheNumberAndThenAsksForTheBank() {
        let model = ScanToPayModel(api: FixtureClient())
        model.scanned(text: ["Account", "0123456789"])
        XCTAssertTrue(model.isScanning)
        XCTAssertEqual(model.spotted, "0123456789")

        model.useSpotted()
        XCTAssertEqual(model.result, .numberOnly("0123456789"))

        model.pick(institution: Institution(code: "058", name: "GTBank", logoKey: "gtbank"))
        guard case .bank(let number, let institution, _) = model.result else { return XCTFail() }
        XCTAssertEqual(number, "0123456789")
        XCTAssertEqual(institution.code, "058")
    }

    func testScanningAgainClearsTheResult() {
        let model = ScanToPayModel(api: FixtureClient())
        model.scanned(code: "hello")
        XCTAssertEqual(model.result, .nothing)
        model.scanAgain()
        XCTAssertNil(model.result)
        XCTAssertTrue(model.isScanning)
    }
}
