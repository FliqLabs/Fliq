import Foundation

/// A stablecoin amount in integer base units (6 decimals for USDC and USDT).
/// The API sends these as decimal strings, never floats; arithmetic happens only here.
struct TokenAmount: Codable, Hashable, Sendable, Comparable {
    static let decimalPlaces = 6
    static let base: Int64 = 1_000_000
    static let zero = TokenAmount(baseUnits: 0)

    let baseUnits: Int64

    init(baseUnits: Int64) {
        self.baseUnits = baseUnits
    }

    init?(decimalString: String) {
        let pieces = decimalString.split(separator: ".", omittingEmptySubsequences: false)
        guard
            (1...2).contains(pieces.count),
            let whole = Int64(pieces[0]), whole >= 0,
            pieces.allSatisfy({ $0.allSatisfy(\.isASCII) && $0.allSatisfy(\.isNumber) })
        else { return nil }

        let fraction = pieces.count == 2 ? String(pieces[1]) : ""
        guard fraction.count <= Self.decimalPlaces,
              let fractionUnits = Int64(fraction.padding(toLength: Self.decimalPlaces, withPad: "0", startingAt: 0)),
              whole <= (Int64.max - fractionUnits) / Self.base
        else { return nil }

        baseUnits = whole * Self.base + fractionUnits
    }

    init(from decoder: Decoder) throws {
        let text = try decoder.singleValueContainer().decode(String.self)
        guard let amount = TokenAmount(decimalString: text) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Not a token amount: \(text)"))
        }
        self = amount
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(decimalString)
    }

    static func < (lhs: TokenAmount, rhs: TokenAmount) -> Bool {
        lhs.baseUnits < rhs.baseUnits
    }

    /// Exact, at least two decimals: "50.00", "12.345678".
    var decimalString: String {
        var fraction = String(format: "%06lld", baseUnits % Self.base)
        while fraction.count > 2, fraction.hasSuffix("0") { fraction.removeLast() }
        return "\(baseUnits / Self.base).\(fraction)"
    }
}

enum Money {
    private static let locale = Locale(identifier: "en_US")

    static func local(_ amount: Int, _ currency: Currency) -> String {
        currency.symbol + amount.formatted(.number.locale(locale))
    }

    static func rate(_ rate: Double, _ currency: Currency) -> String {
        currency.symbol + rate.formatted(.number.precision(.fractionLength(2)).locale(locale))
    }

    /// Minor units (kobo) to the whole-unit string the receipt shows: 34400 -> "₦344".
    static func fee(_ minorUnits: Int, _ currency: Currency) -> String {
        local(minorUnits / 100, currency)
    }

    /// A preview before the quote lands, rounded down so it never promises more than the quote.
    /// The number the user commits to is always `Quote.receive` from the server.
    static func estimate(_ amount: TokenAmount, at rate: Double) -> Int {
        Int((Double(amount.baseUnits) * rate / Double(TokenAmount.base)).rounded(.down))
    }

    /// The dollars it takes for `local` to land at `rate`, rounded up to the cent so the estimate is never short.
    static func cost(ofLocal local: Double, at rate: Double) -> TokenAmount? {
        guard rate > 0, local >= 0 else { return nil }
        let cents = (local / rate * 100 - 1e-6).rounded(.up)
        guard cents < 1e15 else { return nil }
        return TokenAmount(baseUnits: Int64(max(cents, 0)) * (TokenAmount.base / 100))
    }

    /// A typed amount with thousands separators, keeping whatever decimals are typed so far: "7500." -> "7,500.".
    static func typed(_ text: String) -> String {
        guard !text.isEmpty else { return "0" }
        let parts = text.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
        guard let whole = Int(parts[0]) else { return text }
        let grouped = whole.formatted(.number.locale(locale))
        return parts.count == 2 ? grouped + "." + parts[1] : grouped
    }

    /// How much more the routed provider pays than the next live one, in whole local units.
    static func routeAdvantage(_ quote: Quote) -> Int? {
        let live = quote.routes.filter { $0.status == .live }.compactMap(\.rate).sorted(by: >)
        guard live.count >= 2 else { return nil }
        let units = Double(quote.amount.baseUnits) / Double(TokenAmount.base)
        return Int(((live[0] - live[1]) * units).rounded())
    }

    /// Whole dollars without decimals ("128"), otherwise cents rounded half up ("128.18").
    static func dollars(_ amount: TokenAmount) -> String {
        let cents = (amount.baseUnits + TokenAmount.base / 200) / (TokenAmount.base / 100)
        let whole = (cents / 100).formatted(.number.locale(locale))
        return cents % 100 == 0 ? whole : whole + "." + String(format: "%02lld", cents % 100)
    }
}
