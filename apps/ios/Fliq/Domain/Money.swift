import Foundation

enum Money {
    private static let locale = Locale(identifier: "en_US")

    static func local(_ amount: Int, _ currency: Currency) -> String {
        currency.symbol + amount.formatted(.number.locale(locale))
    }

    static func rate(_ rate: Double, _ currency: Currency) -> String {
        currency.symbol + rate.formatted(.number.precision(.fractionLength(2)).locale(locale))
    }

    static func dollars(_ amount: Decimal) -> String {
        amount.formatted(.number.precision(.fractionLength(0...2)).locale(locale))
    }
}
