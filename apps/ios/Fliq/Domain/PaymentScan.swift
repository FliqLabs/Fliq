import Foundation

/// What a scanned QR code or a block of text can be paid as.
enum ScanResult: Equatable {
    /// A national payment QR code, such as Pix, PromptPay, UPI or NQR.
    case code(ScannedCode)
    /// A Nigerian account number and its bank, read from text.
    case bank(number: String, institution: Institution, name: String?)
    /// An account number with no bank fliq could recognise next to it.
    case numberOnly(String)
    /// More than one account number in view.
    case choose([String], institution: Institution?)
    /// A fliq user, from a request link or a fliq name.
    case fliqName(String)
    /// A payment code whose checksum doesn't match: misread or altered.
    case damaged
    case nothing
}

/// What a national QR code says: who is paid, where, and how much, in the scheme's own terms.
struct ScannedCode: Equatable {
    enum Scheme: String, Equatable {
        case pix, promptPay, payNow, sgqr, duitNow, qris, qrPh, vietQR, upi, nqr, mpesa, emv

        var name: String {
            switch self {
            case .pix: "Pix"
            case .promptPay: "PromptPay"
            case .payNow: "PayNow"
            case .sgqr: "SGQR"
            case .duitNow: "DuitNow"
            case .qris: "QRIS"
            case .qrPh: "QR Ph"
            case .vietQR: "VietQR"
            case .upi: "UPI"
            case .nqr: "NQR"
            case .mpesa: "M-Pesa"
            case .emv: "QR payment"
            }
        }
    }

    var scheme: Scheme
    /// ISO 3166 alpha-2, as the code states it.
    var country: String?
    var merchant: String?
    var city: String?
    /// ISO 4217 alpha-3.
    var currency: String?
    var amount: Decimal?
    /// The scheme's own payee id: a Pix key, a UPI address, a PayNow proxy.
    var payee: String?
    /// Set only where fliq can pay out today.
    var account: PayableAccount?

    var countryName: String? {
        country.flatMap { Locale(identifier: "en_US").localizedString(forRegionCode: $0) }
    }

    var flag: String? {
        guard let country, country.count == 2 else { return nil }
        return String(String.UnicodeScalarView(country.uppercased().unicodeScalars.compactMap { Unicode.Scalar(127_397 + $0.value) }))
    }

    var title: String {
        [scheme.name, countryName].compactMap { $0 }.joined(separator: " · ")
    }

    /// Why it can't be paid yet, in the words the result card shows.
    var comingSoon: String? {
        guard account == nil else { return nil }
        switch scheme {
        case .nqr: return "Paying NQR merchant codes is coming soon."
        case .mpesa: return "Paying M-Pesa tills and paybills is coming soon."
        default: return "Paying in \(countryName ?? "this country") is coming soon."
        }
    }
}

struct PayableAccount: Equatable {
    let number: String
    let institution: Institution
}

enum PaymentScan {
    static func parse(_ payload: String, institutions: [Institution] = Institution.supported) -> ScanResult {
        let text = payload.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return .nothing }
        if let name = fliqName(in: text) { return .fliqName(name) }
        if let upi = UPICode.parse(text) { return .code(upi) }
        if EMVCode.looksLikeEMV(text) {
            guard let fields = EMVCode.fields(text) else { return .damaged }
            return .code(EMVCode.read(fields, institutions: institutions))
        }
        return plain(text, institutions: institutions)
    }

    // MARK: fliq

    private static func fliqName(in text: String) -> String? {
        let lower = text.lowercased()
        if let link = lower.firstMatch(of: /fliq\.cash\/pay\/([a-z0-9_-]{2,64})\//) { return String(link.1) }
        let suffix = FliqName.suffix.lowercased()
        guard lower.hasSuffix(suffix), !lower.contains(" ") else { return nil }
        let name = String(lower.dropLast(suffix.count))
        return name.isEmpty ? nil : name
    }

    // MARK: Text

    private static func plain(_ text: String, institutions: [Institution]) -> ScanResult {
        let numbers = nubans(in: text)
        guard !numbers.isEmpty else { return .nothing }
        let institution = BankDirectory.institution(named: text, in: institutions)
        guard numbers.count == 1, let number = numbers.first else { return .choose(numbers, institution: institution) }
        guard let institution else { return .numberOnly(number) }
        return .bank(number: number, institution: institution, name: nil)
    }

    /// Ten-digit runs, also when printed in groups like "012 345 6789" or "0123-456-789".
    static func nubans(in text: String) -> [String] {
        var found: [String] = []
        var run = ""
        var gap = false
        func close() {
            if run.count == 10, !found.contains(run) { found.append(run) }
            run = ""
            gap = false
        }
        for character in text {
            if character.isNumber, character.isASCII {
                run.append(character)
                gap = false
            } else if (character == " " || character == "-"), !run.isEmpty, !gap, run.count < 10 {
                gap = true
            } else {
                close()
            }
        }
        close()
        return found
    }

}

/// EMV merchant-presented QR codes (EMVCo), the base of Pix, PromptPay, PayNow, SGQR, DuitNow, QRIS, QR Ph, VietQR
/// and NQR: two-digit tag, two-digit length, value, ending in a CRC-16/CCITT-FALSE over everything before it.
enum EMVCode {
    struct Field: Equatable {
        let tag: String
        let value: String
    }

    static func looksLikeEMV(_ text: String) -> Bool {
        text.hasPrefix("000201")
    }

    /// The top-level fields of a well-formed code whose checksum matches, or nil.
    static func fields(_ text: String) -> [Field]? {
        guard looksLikeEMV(text), let fields = walk(text), fields.last?.tag == "63", hasValidCRC(text) else { return nil }
        return fields
    }

    static func walk(_ text: String) -> [Field]? {
        var fields: [Field] = []
        var rest = Substring(text)
        while !rest.isEmpty {
            guard rest.count >= 4, let length = Int(rest.dropFirst(2).prefix(2)) else { return nil }
            let tag = String(rest.prefix(2))
            let body = rest.dropFirst(4)
            guard body.count >= length else { return nil }
            fields.append(Field(tag: tag, value: String(body.prefix(length))))
            rest = body.dropFirst(length)
        }
        return fields
    }

    static func hasValidCRC(_ text: String) -> Bool {
        guard text.count > 8 else { return false }
        let checked = String(text.dropLast(4))
        guard checked.hasSuffix("6304") else { return false }
        return String(format: "%04X", crc16(checked)) == text.suffix(4).uppercased()
    }

    static func crc16(_ text: String) -> UInt16 {
        var crc: UInt16 = 0xFFFF
        for byte in text.utf8 {
            crc ^= UInt16(byte) << 8
            for _ in 0..<8 { crc = crc & 0x8000 != 0 ? (crc << 1) ^ 0x1021 : crc << 1 }
        }
        return crc
    }

    // MARK: Meaning

    static func read(_ fields: [Field], institutions: [Institution]) -> ScannedCode {
        let value = { (tag: String) in fields.first { $0.tag == tag }?.value }
        let templates = fields.filter { (26...51).contains(Int($0.tag) ?? 0) }.map { walk($0.value) ?? [] }
        let country = value("58")?.uppercased()
        let (scheme, payee) = scheme(in: templates, country: country)
        var code = ScannedCode(
            scheme: scheme,
            country: country,
            merchant: value("59")?.trimmingCharacters(in: .whitespaces),
            city: value("60")?.trimmingCharacters(in: .whitespaces),
            currency: value("53").flatMap { currencies[$0] },
            amount: value("54").flatMap { Decimal(string: $0, locale: Locale(identifier: "en_US_POSIX")) },
            payee: payee
        )
        code.account = account(in: templates, country: country, institutions: institutions)
        if country == "KE", code.account == nil, scheme == .emv { code.scheme = .mpesa }
        return code
    }

    /// The scheme from a template's globally unique id or application id, most specific first.
    private static func scheme(in templates: [[Field]], country: String?) -> (ScannedCode.Scheme, String?) {
        let known: [(ScannedCode.Scheme, (String) -> Bool, [String])] = [
            (.pix, { $0 == "BR.GOV.BCB.PIX" }, ["01"]),
            (.promptPay, { $0.hasPrefix("A000000677") }, ["01", "02", "03"]),
            (.payNow, { $0 == "SG.PAYNOW" }, ["02"]),
            (.duitNow, { $0.hasPrefix("A000000615") }, ["01", "02"]),
            (.qris, { $0.hasPrefix("ID.CO.") }, ["01", "02"]),
            (.qrPh, { $0 == "COM.P2PQRPAY" || $0.hasPrefix("PH.PPMI") }, ["03", "04", "01"]),
            (.vietQR, { $0.hasPrefix("A000000727") }, ["01"]),
            (.nqr, { $0.hasPrefix("NG.COM.NIBSS") }, []),
            (.mpesa, { $0.contains("MPESA") || $0.contains("SAFARICOM") }, ["01"]),
            (.sgqr, { $0 == "SG.SGQR" }, ["01"]),
        ]
        for (scheme, matches, payeeTags) in known {
            for template in templates {
                guard let id = template.first(where: { $0.tag == "00" })?.value.uppercased(), matches(id) else { continue }
                let payee = payeeTags.lazy.compactMap { tag in template.first { $0.tag == tag }?.value }.first
                return (scheme, payee.map { scheme == .vietQR ? vietQRAccount($0) : $0 })
            }
        }
        if country == "NG" { return (.nqr, nil) }
        return (.emv, nil)
    }

    /// VietQR nests the beneficiary: bank BIN in 00, account in 01.
    private static func vietQRAccount(_ value: String) -> String {
        guard let inner = walk(value), let account = inner.first(where: { $0.tag == "01" })?.value else { return value }
        let bin = inner.first { $0.tag == "00" }?.value
        return bin.map { "\(account) · bank \($0)" } ?? account
    }

    /// Where fliq can pay out today: a Nigerian account with its bank, or a Kenyan M-Pesa number.
    private static func account(in templates: [[Field]], country: String?, institutions: [Institution]) -> PayableAccount? {
        let values = templates.flatMap { $0.map(\.value) }
        switch country {
        case "NG":
            guard let number = values.first(where: { $0.count == 10 && $0.allSatisfy(\.isNumber) }) else { return nil }
            let institution = values.lazy.compactMap { BankDirectory.institution(code: $0, in: institutions) }.first
            return institution.map { PayableAccount(number: number, institution: $0) }
        case "KE":
            guard let phone = values.lazy.compactMap(kenyanMobile).first else { return nil }
            return PayableAccount(number: phone, institution: .mpesa)
        default:
            return nil
        }
    }

    /// 07XXXXXXXX or 01XXXXXXXX, from either that form or 2547…/2541….
    static func kenyanMobile(_ value: String) -> String? {
        let digits = value.filter(\.isNumber)
        guard digits.count == value.filter({ !$0.isWhitespace && $0 != "+" }).count else { return nil }
        if digits.count == 12, digits.hasPrefix("2547") || digits.hasPrefix("2541") { return "0" + digits.dropFirst(3) }
        if digits.count == 10, digits.hasPrefix("07") || digits.hasPrefix("01") { return digits }
        return nil
    }

    private static let currencies = [
        "986": "BRL", "764": "THB", "702": "SGD", "458": "MYR", "360": "IDR", "608": "PHP", "704": "VND",
        "356": "INR", "566": "NGN", "404": "KES", "840": "USD",
    ]
}

/// India's UPI: upi://pay?pa=<address>&pn=<name>&am=<amount>&cu=INR.
enum UPICode {
    static func parse(_ text: String) -> ScannedCode? {
        guard let url = URLComponents(string: text), url.scheme?.lowercased() == "upi", url.host?.lowercased() == "pay" else { return nil }
        let query = { (name: String) in url.queryItems?.first { $0.name.lowercased() == name }?.value }
        guard let address = query("pa"), address.contains("@") else { return nil }
        return ScannedCode(
            scheme: .upi,
            country: "IN",
            merchant: query("pn"),
            currency: query("cu")?.uppercased() ?? "INR",
            amount: query("am").flatMap { Decimal(string: $0, locale: Locale(identifier: "en_US_POSIX")) },
            payee: address
        )
    }
}

extension Institution {
    static let mpesa = Institution(code: "mpesa", name: "M-Pesa", type: .mobileMoney, country: .ke, logoKey: "mpesa")
}

/// Nigerian banks by the codes and names people and QR codes use for them.
enum BankDirectory {
    /// fliq's own code for a bank, from its NIP code or its old three-digit CBN code.
    private static let codes: [String: String] = [
        "000013": "058", "000014": "044", "100004": "999992",
        "058": "058", "044": "044", "057": "000015", "011": "000016", "033": "000004", "214": "000003",
        "070": "000007", "232": "000001", "035": "000017", "032": "000018", "221": "000012", "050": "000010",
        "076": "000008", "082": "000002", "101": "000023", "030": "000020", "215": "000011", "301": "000006",
        "068": "000021", "023": "000009", "103": "000027",
    ]

    /// Names people write, longest first wins, matched as whole words.
    private static let names: [(String, String)] = [
        ("guaranty trust", "058"), ("gtbank", "058"), ("gt bank", "058"), ("gtco", "058"), ("gtb", "058"),
        ("access", "044"), ("opay", "999992"), ("o pay", "999992"), ("paycom", "999992"),
        ("zenith", "000015"), ("first bank", "000016"), ("firstbank", "000016"), ("fbn", "000016"),
        ("united bank for africa", "000004"), ("uba", "000004"), ("moniepoint", "090405"),
        ("palmpay", "100033"), ("palm pay", "100033"), ("kuda", "090267"),
        ("first city monument", "000003"), ("fcmb", "000003"), ("fidelity", "000007"), ("sterling", "000001"),
        ("wema", "000017"), ("alat", "000017"), ("union bank", "000018"), ("stanbic", "000012"),
        ("ecobank", "000010"), ("polaris", "000008"), ("keystone", "000002"), ("providus", "000023"),
        ("heritage", "000020"), ("unity bank", "000011"), ("jaiz", "000006"), ("standard chartered", "000021"),
        ("citibank", "000009"), ("globus", "000027"), ("titan trust", "000025"), ("suntrust", "000022"),
        ("taj bank", "000026"), ("premiumtrust", "000031"), ("premium trust", "000031"), ("optimus", "000036"),
        ("paga", "100002"), ("carbon", "100026"), ("vfd", "090110"), ("fairmoney", "090551"),
        ("sparkle", "090325"), ("9psb", "120001"), ("9 payment service", "120001"), ("momo psb", "120003"),
        ("gomoney", "100022"), ("eyowo", "090328"), ("lapo", "090177"), ("parallex", "090004"),
    ].sorted { $0.0.count > $1.0.count }

    static func institution(code: String, in list: [Institution]) -> Institution? {
        guard code.allSatisfy(\.isNumber), code.count == 3 || code.count == 6 else { return nil }
        let own = codes[code] ?? code
        return list.first { $0.code == own } ?? known(own)
    }

    static func institution(named text: String, in list: [Institution]) -> Institution? {
        let cleaned = String(text.lowercased().map { $0.isLetter || $0.isNumber ? $0 : " " })
        let spaced = " " + cleaned.split(separator: " ").joined(separator: " ") + " "
        if let listed = list.sorted(by: { $0.name.count > $1.name.count }).first(where: { spaced.contains(" \($0.name.lowercased()) ") }) {
            return listed
        }
        guard let code = names.first(where: { spaced.contains(" \($0.0) ") })?.1 else { return nil }
        return list.first { $0.code == code } ?? known(code)
    }

    /// The bank by fliq's code, for when the API's list hasn't loaded.
    private static func known(_ code: String) -> Institution? {
        guard let name = displayNames[code] else { return nil }
        return Institution(code: code, name: name.0, logoKey: name.1)
    }

    private static let displayNames: [String: (String, String)] = [
        "058": ("GTBank", "gtbank"), "044": ("Access Bank", "access-bank"), "999992": ("OPay", "opay"),
        "000015": ("Zenith Bank", "zenith-bank"), "000016": ("First Bank", "first-bank"), "000004": ("UBA", "uba"),
        "090405": ("Moniepoint", "moniepoint"), "100033": ("PalmPay", "palmpay"), "090267": ("Kuda", "kuda"),
        "000003": ("FCMB", "fcmb"), "000007": ("Fidelity Bank", "fidelity-bank"), "000001": ("Sterling Bank", "sterling-bank"),
        "000017": ("Wema Bank", "wema-bank"), "000018": ("Union Bank", "union-bank"), "000012": ("Stanbic IBTC", "stanbic-ibtc"),
        "000010": ("Ecobank", "ecobank"), "000008": ("Polaris Bank", "polaris-bank"), "000002": ("Keystone Bank", "keystone-bank"),
        "000023": ("Providus Bank", "providus-bank"), "000020": ("Heritage Bank", "heritage-bank"), "000011": ("Unity Bank", "unity-bank"),
        "000006": ("Jaiz Bank", "jaiz-bank"), "000021": ("Standard Chartered", "standard-chartered"), "000009": ("Citibank", "citibank"),
        "000027": ("Globus Bank", "globus-bank"), "000025": ("Titan Trust Bank", "titan-trust-bank"), "000022": ("SunTrust Bank", "suntrust-bank"),
        "000026": ("TAJ Bank", "taj-bank"), "000031": ("PremiumTrust Bank", "premiumtrust-bank"), "000036": ("Optimus Bank", "optimus-bank"),
        "100002": ("Paga", "paga"), "100026": ("Carbon", "carbon"), "090110": ("VFD Microfinance Bank", "vfd"),
        "090551": ("FairMoney", "fairmoney"), "090325": ("Sparkle", "sparkle"), "120001": ("9PSB", "9psb"),
        "120003": ("MoMo PSB", "momo-psb"), "100022": ("GoMoney", "gomoney"), "090328": ("Eyowo", "eyowo"),
        "090177": ("LAPO Microfinance Bank", "lapo"), "090004": ("Parallex Bank", "parallex-bank"),
    ]
}
