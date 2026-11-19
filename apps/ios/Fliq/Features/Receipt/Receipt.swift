import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

/// What a shared receipt shows: one page, the way a bank's proof of payment reads, as a PDF or an image.
struct ReceiptDocument: Equatable {
    enum Tone: Equatable { case good, moving, bad }

    /// How anyone can check the payment without trusting fliq.
    enum Proof: Equatable {
        /// A public explorer page for the transaction, shown as a QR code.
        case explorer(URL, network: String)
        /// The bank's own NIP session ID for a Naira payout.
        case bank(String)
    }

    struct Item: Equatable {
        let label: String
        let value: String
        var mono = false
    }

    let kind: String
    let status: String
    let tone: Tone
    let amountLabel: String
    let amount: String
    let caption: String
    let date: Date
    let partyHeading: String
    let party: [Item]
    let details: [Item]
    let reference: String
    var proof: Proof?

    var fileName: String {
        let safe = reference.filter { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
        return "fliq-receipt-\(safe.isEmpty ? "payment" : String(safe.suffix(32)))"
    }
}

extension ReceiptDocument {
    /// A row from Activity.
    init(line: ActivityLine) {
        let facts = line.facts.filter { !$0.1.isEmpty }
        let value = { (label: String) in facts.first { $0.0 == label }?.1 }
        let incoming = line.category == "Received" || line.category == "Deposit"
        let partyLabels = ["Bank", "Account", "To", "From", "Network", "You sent"]
        var party = [Item(label: incoming ? "From" : "Recipient", value: line.title)]
        var used: Set<String> = []
        for label in partyLabels where party.count < 3 {
            guard let found = value(label), found != line.title else { continue }
            let isAccount = label == "To" || label == "From"
            party.append(Item(label: isAccount ? "fliq account" : label, value: found, mono: isAccount || label == "Account"))
            used.insert(label)
        }
        // The amount is the headline, and the status is the chip, so neither repeats in the table.
        let shown: Set<String> = used.union(["Status", "Reference", "Amount"])
        var details = [Item(label: "Transaction type", value: Self.kind(line.category).capitalized)]
        details += facts.filter { !shown.contains($0.0) }.map { Item(label: $0.0, value: $0.1) }
        let reference = value("Reference") ?? line.id
        details.append(Item(label: "fliq reference", value: reference, mono: true))
        if let hash = line.txHash { details.append(Item(label: "NEAR transaction", value: hash, mono: true)) }

        self.init(
            kind: Self.kind(line.category),
            status: line.outcome == .done ? "Completed" : line.statusText,
            tone: Self.tone(line.outcome),
            amountLabel: Self.amountLabel(line.category),
            amount: Self.unsigned(line.amount),
            caption: Self.caption(line.category, title: line.title, bank: value("Bank")),
            date: line.date,
            partyHeading: incoming ? "FROM" : "TO",
            party: party,
            details: details,
            reference: reference,
            proof: line.txHash.flatMap { NearNetwork.current.explorer(transaction: $0) }.map { .explorer($0, network: "NEAR") }
                ?? line.bankReference.map(Proof.bank)
        )
    }

    /// The receipt at the end of a cash-out.
    init(payout: Payout) {
        let bank = payout.institutionName
        let settled = payout.history.last { $0.state == .settled }?.at
        var details = [
            Item(label: "Transaction type", value: "Cash out"),
            Item(label: "From your vault", value: "$" + payout.amount.decimalString),
            Item(label: "Rate after fees", value: "$1 = " + Money.rate(payout.rate, payout.currency)),
            Item(label: "Paid out by", value: payout.provider.displayName),
            Item(label: "fliq reference", value: payout.payoutId, mono: true),
        ]
        // With a session ID the bank box below shows it; without one the table says it is not in yet.
        if payout.bankReference == nil, payout.state == .settled { details.append(Item(label: "NIP session ID", value: "Not sent by the bank yet")) }
        self.init(
            kind: "CASH OUT",
            status: payout.state == .settled ? "Completed" : payout.state == .refunded ? "Refunded" : "In progress",
            tone: payout.state == .settled ? .good : payout.state == .refunded ? .bad : .moving,
            amountLabel: "They receive",
            amount: Money.local(payout.receive, payout.currency),
            caption: "Paid to \(payout.accountName) at \(bank)",
            date: settled ?? payout.history.first?.at ?? .now,
            partyHeading: "TO",
            party: [
                Item(label: "Recipient", value: payout.accountName),
                Item(label: "Bank", value: bank),
                Item(label: "Account", value: "•••• " + String(payout.account.number.suffix(4)), mono: true),
            ],
            details: details,
            reference: payout.payoutId,
            proof: payout.bankReference.map(Proof.bank)
        )
    }

    /// USDC sent to a wallet, on NEAR or another network.
    init(sent: WithdrawFlow.Sent) {
        let network = "\(sent.network.tokenName) on \(sent.network.name)"
        var details = [
            Item(label: "Transaction type", value: "Send to a wallet"),
            Item(label: "Amount sent", value: "$" + Money.dollars(sent.amount)),
            Item(label: sent.network.isNEAR ? "Fee" : "Network fee", value: sent.fee.map { "$" + Money.dollars($0) } ?? "Free"),
        ]
        if let explorer = sent.explorer { details.append(Item(label: "\(sent.network.name) transaction", value: explorer.lastPathComponent, mono: true)) }
        self.init(
            kind: "SEND",
            status: sent.returned ? "Returned" : sent.delivered ? "Completed" : "Sending",
            tone: sent.returned ? .bad : sent.delivered ? .good : .moving,
            amountLabel: "Amount sent",
            amount: "$" + Money.dollars(sent.amount),
            caption: "Sent to \(WithdrawAddress.short(sent.address)) on \(sent.network.name)",
            date: sent.at,
            partyHeading: "TO",
            party: [
                Item(label: "Wallet", value: sent.address, mono: true),
                Item(label: "Network", value: network),
                Item(label: "They receive", value: "$" + Money.dollars(sent.receives ?? sent.amount)),
            ],
            details: details,
            reference: sent.explorer?.lastPathComponent ?? "",
            proof: sent.explorer.map { .explorer($0, network: sent.network.name) }
        )
    }

    /// The chip that says what kind of payment it was. The status chip next to it says how it ended.
    private static func kind(_ category: String) -> String {
        switch category {
        case "Sent", "Received": "TRANSFER"
        default: category.uppercased()
        }
    }

    /// "-$1.00" in a list of money in and out reads as "$1.00" on a receipt, which already says which way it went.
    static func unsigned(_ amount: String) -> String {
        guard let first = amount.first, first == "-" || first == "+" || first == "−" else { return amount }
        return String(amount.dropFirst()).trimmingCharacters(in: .whitespaces)
    }

    private static func tone(_ outcome: ActivityLine.Outcome) -> Tone {
        switch outcome {
        case .done: .good
        case .moving: .moving
        case .refunded, .refused, .failed: .bad
        }
    }

    private static func amountLabel(_ category: String) -> String {
        switch category {
        case "Cash out": "They receive"
        case "Received": "Amount received"
        case "Deposit": "Amount added"
        case "Refused": "Amount asked for"
        default: "Amount sent"
        }
    }

    private static func caption(_ category: String, title: String, bank: String?) -> String {
        switch category {
        case "Cash out": "Paid to \(title)" + (bank.map { " at \($0)" } ?? "")
        case "Received": "From \(title) on fliq"
        case "Deposit": title
        case "Refused": "Refused by your vault: \(title)"
        default: "Sent to \(title)"
        }
    }
}

// MARK: - Page

/// The printed page. Light on purpose: receipts get printed, forwarded and opened in apps with white backgrounds.
struct ReceiptPage: View {
    let document: ReceiptDocument
    /// True for the PDF: an A4 page with the footer at the bottom. False for the image: as tall as the content.
    var fullPage = true
    var issued = Date.now

    static let width: CGFloat = 595
    static let height: CGFloat = 842

    private let ink = Color(hex: 0x111214)
    private let muted = Color(hex: 0x6B6F76)
    private let line = Color(hex: 0xE6E7EA)
    private let card = Color(hex: 0xF4F5F7)
    private let brand = Color(hex: 0x5B45F5)
    private let good = Color(hex: 0x1E8E4A)

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            divider.padding(.top, 18)
            chips.padding(.top, 22)
            hero.padding(.top, 18)
            partyCard.padding(.top, 24)
            detailsTable.padding(.top, 28)
            if fullPage { Spacer(minLength: 24) } else { Color.clear.frame(height: 30) }
            proofBox
            footer.padding(.top, 22)
        }
        .padding(.horizontal, 52)
        .padding(.top, 42)
        .padding(.bottom, 34)
        .frame(width: Self.width, height: fullPage ? Self.height : nil, alignment: .top)
        .background(Color.white)
        .foregroundStyle(ink)
        .environment(\.colorScheme, .light)
    }

    private var divider: some View { Rectangle().fill(line).frame(height: 1) }

    private var header: some View {
        HStack(alignment: .center) {
            HStack(spacing: 10) {
                Image("FliqMark").resizable().scaledToFit().frame(width: 34, height: 34)
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                Text("fliq").font(.system(size: 26, weight: .semibold)).tracking(-0.5)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text("Proof of payment").font(.system(size: 15, weight: .semibold))
                Text(document.reference).font(.system(size: 9.5, design: .monospaced)).foregroundStyle(muted)
                    .lineLimit(1).truncationMode(.middle)
            }
            .frame(maxWidth: 260, alignment: .trailing)
        }
    }

    private var chips: some View {
        HStack(spacing: 8) {
            Text(document.kind)
                .font(.system(size: 9, weight: .bold)).tracking(1)
                .padding(.horizontal, 11).padding(.vertical, 6)
                .background(card, in: Capsule())
            HStack(spacing: 5) {
                Circle().fill(toneColor).frame(width: 5, height: 5)
                Text(document.status.uppercased()).font(.system(size: 9, weight: .bold)).tracking(1)
            }
            .foregroundStyle(toneColor)
            .padding(.horizontal, 11).padding(.vertical, 6)
            .background(toneColor.opacity(0.1), in: Capsule())
        }
    }

    private var hero: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 6) {
                Text(document.amountLabel).font(.system(size: 11)).foregroundStyle(muted)
                Text(document.amount)
                    .font(.system(size: 40, weight: .bold)).tracking(-1).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.5)
                Text(document.caption).font(.system(size: 12)).foregroundStyle(muted).lineLimit(2)
            }
            Spacer(minLength: 20)
            VStack(alignment: .trailing, spacing: 5) {
                Text(document.status).font(.system(size: 11)).foregroundStyle(muted)
                Text(Self.day(document.date)).font(.system(size: 15, weight: .semibold))
                Text(Self.clock(document.date)).font(.system(size: 11)).foregroundStyle(muted)
            }
        }
    }

    private var partyCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(document.partyHeading).font(.system(size: 8.5, weight: .bold)).tracking(1.2).foregroundStyle(muted)
            HStack(alignment: .top, spacing: 18) {
                ForEach(Array(document.party.enumerated()), id: \.offset) { index, item in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(item.label).font(.system(size: 10)).foregroundStyle(muted)
                        Text(item.value)
                            .font(item.mono ? .system(size: 10.5, design: .monospaced) : .system(size: 12.5))
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: index == 0 ? .infinity : 150, alignment: .leading)
                }
            }
        }
        .padding(.horizontal, 24).padding(.vertical, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var detailsTable: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Transaction details").font(.system(size: 13.5, weight: .semibold)).padding(.bottom, 12)
            divider
            ForEach(Array(document.details.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .firstTextBaseline, spacing: 16) {
                    Text(item.label).font(.system(size: 11)).foregroundStyle(muted).frame(width: 150, alignment: .leading)
                    Text(item.value)
                        .font(item.mono ? .system(size: 10, design: .monospaced) : .system(size: 11.5))
                        .foregroundStyle(item.mono && item.label.hasSuffix("transaction") ? brand : ink)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 10)
                divider
            }
        }
    }

    @ViewBuilder
    private var proofBox: some View {
        switch document.proof {
        case .explorer(let url, let network):
            HStack(alignment: .center, spacing: 20) {
                if let qr = Self.qr(url.absoluteString) {
                    Image(uiImage: qr).interpolation(.none).resizable().frame(width: 76, height: 76)
                        .padding(6).background(Color.white, in: RoundedRectangle(cornerRadius: 8))
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("Check it on \(network)").font(.system(size: 13.5, weight: .semibold))
                    Text("This payment is recorded on the \(network) blockchain. Scan the code or open the link to see it on a public explorer that fliq doesn't run.")
                        .font(.system(size: 10.5)).foregroundStyle(muted).fixedSize(horizontal: false, vertical: true)
                    Text(url.host().map { $0 + url.path() } ?? url.absoluteString)
                        .font(.system(size: 9.5, weight: .medium, design: .monospaced)).foregroundStyle(brand)
                        .lineLimit(1).truncationMode(.middle)
                }
            }
            .padding(22)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(brand.opacity(0.07), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        case .bank(let session):
            HStack(alignment: .top, spacing: 16) {
                Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
                    .frame(width: 30, height: 30).background(good, in: Circle())
                VStack(alignment: .leading, spacing: 6) {
                    Text("Check it with the bank").font(.system(size: 13.5, weight: .semibold))
                    Text("The NIP session ID is the bank's own reference for this transfer. The receiving bank can confirm it.")
                        .font(.system(size: 10.5)).foregroundStyle(muted).fixedSize(horizontal: false, vertical: true)
                    Text(session).font(.system(size: 10, weight: .medium, design: .monospaced)).foregroundStyle(good)
                }
            }
            .padding(22)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(good.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        case nil:
            EmptyView()
        }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 5) {
            divider.padding(.bottom, 10)
            Text("Issued \(Self.day(issued)), \(Self.clock(issued)) · fliq.cash")
            Text("fliq issued this receipt at the account holder's request. It shows the payment as recorded when it was issued.")
        }
        .font(.system(size: 8.5))
        .foregroundStyle(muted)
    }

    private var toneColor: Color {
        switch document.tone {
        case .good: good
        case .moving: muted
        case .bad: Color(hex: 0xB4232A)
        }
    }

    static func day(_ date: Date) -> String {
        date.formatted(.dateTime.day().month(.wide).year().locale(Locale(identifier: "en_GB")))
    }

    static func clock(_ date: Date) -> String {
        var style = Date.FormatStyle.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).second(.twoDigits)
        style.timeZone = TimeZone(identifier: "UTC")!
        return date.formatted(style.locale(Locale(identifier: "en_GB"))) + " UTC"
    }

    static func qr(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage, let image = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: image)
    }
}

// MARK: - Files

@MainActor
enum ReceiptFiles {
    /// A one-page A4 PDF with real text, so it can be searched, printed and attached.
    static func pdf(_ document: ReceiptDocument) throws -> URL {
        let url = folder().appendingPathComponent(document.fileName + ".pdf")
        let renderer = ImageRenderer(content: ReceiptPage(document: document, fullPage: true))
        var box = CGRect(x: 0, y: 0, width: ReceiptPage.width, height: ReceiptPage.height)
        guard let context = CGContext(url as CFURL, mediaBox: &box, nil) else { throw CocoaError(.fileWriteUnknown) }
        renderer.render { _, draw in
            context.beginPDFPage(nil)
            draw(context)
            context.endPDFPage()
            context.closePDF()
        }
        return url
    }

    /// A PNG as tall as the receipt, for chats that show images inline.
    static func image(_ document: ReceiptDocument) throws -> URL {
        let url = folder().appendingPathComponent(document.fileName + ".png")
        let renderer = ImageRenderer(content: ReceiptPage(document: document, fullPage: false))
        renderer.scale = 3
        guard let data = renderer.uiImage?.pngData() else { throw CocoaError(.fileWriteUnknown) }
        try data.write(to: url, options: .atomic)
        return url
    }

    private static func folder() -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("receipts", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}

/// "Share receipt": a choice of image or PDF, both made on the phone the moment the screen opens.
struct ReceiptShareButton<Label: View>: View {
    let document: ReceiptDocument
    @ViewBuilder var label: () -> Label
    @State private var files: (image: URL, pdf: URL)?

    var body: some View {
        Menu {
            if let files {
                ShareLink(item: files.image) { SwiftUI.Label("Share as image", systemImage: "photo") }
                ShareLink(item: files.pdf) { SwiftUI.Label("Share as PDF", systemImage: "doc.richtext") }
            }
        } label: {
            label()
        }
        .disabled(files == nil)
        .task(id: document) {
            files = try? (ReceiptFiles.image(document), ReceiptFiles.pdf(document))
        }
    }
}
