import Foundation

/// A payment request link. The web page's "Open fliq" button opens `fliq://pay/{name}/{code}`; the shared link itself
/// is `https://pay.fliq.money/{name}/{code}` or `https://fliq.cash/pay/{name}/{code}`.
struct PayLink: Equatable, Hashable, Sendable {
    let name: String
    let code: String

    init(name: String, code: String) {
        self.name = name
        self.code = code
    }

    init?(_ url: URL) {
        var parts = url.pathComponents.filter { $0 != "/" }
        switch url.scheme?.lowercased() {
        case "fliq":
            guard url.host?.lowercased() == "pay" else { return nil }
        case "https":
            let host = url.host?.lowercased() ?? ""
            if host == "fliq.cash" || host == "www.fliq.cash" {
                guard parts.first?.lowercased() == "pay" else { return nil }
                parts.removeFirst()
            } else if host != "pay.fliq.money" {
                return nil
            }
        default:
            return nil
        }
        guard parts.count == 2 else { return nil }
        let name = parts[0].lowercased()
        let code = parts[1]
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_."))
        guard (1...64).contains(name.count), (1...64).contains(code.count),
              name.unicodeScalars.allSatisfy(allowed.contains), code.unicodeScalars.allSatisfy(allowed.contains)
        else { return nil }
        self.init(name: name, code: code)
    }
}

/// `GET /pay/{name}/{code}`: the request as the payer sees it.
struct PublicPayRequest: Decodable, Equatable, Sendable {
    let nearAccount: String
    let displayName: String?
    let amount: String
    let note: String
    let state: String
}
