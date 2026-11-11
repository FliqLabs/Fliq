import AVFoundation
import SwiftUI
import UIKit
import VisionKit

/// Turns what the camera sees into a payment: a national QR code, a bank account in text, or a fliq user.
@MainActor
@Observable
final class ScanToPayModel: Identifiable {
    private(set) var result: ScanResult?
    /// A ten-digit number seen in text with no bank beside it yet, offered without stopping the camera.
    private(set) var spotted: String?
    /// What the code's local amount comes to in USDC, where the API has a rate for its currency.
    private(set) var estimate: Decimal?
    let entry: AccountEntry

    private let api: any FliqAPI

    init(api: any FliqAPI) {
        self.api = api
        entry = AccountEntry(api: api)
    }

    var institutions: [Institution] { entry.institutions }
    var isScanning: Bool { result == nil }

    func load() async {
        await entry.loadInstitutions()
    }

    /// A QR code always stops the camera; text only once it names an account and its bank.
    func scanned(code payload: String) {
        guard isScanning else { return }
        settle(PaymentScan.parse(payload, institutions: institutions))
    }

    func scanned(text blocks: [String]) {
        guard isScanning else { return }
        let parsed = PaymentScan.parse(blocks.joined(separator: "\n"), institutions: institutions)
        switch parsed {
        case .bank: settle(parsed)
        case .numberOnly(let number): spotted = number
        case .choose(let numbers, _): spotted = numbers.first
        default: break
        }
    }

    func useSpotted() {
        guard let spotted else { return }
        settle(.numberOnly(spotted))
    }

    func pick(number: String) {
        guard case .choose(_, let institution) = result else { return }
        settle(institution.map { .bank(number: number, institution: $0, name: nil) } ?? .numberOnly(number))
    }

    func pick(institution: Institution) {
        guard case .numberOnly(let number) = result else { return }
        settle(.bank(number: number, institution: institution, name: nil))
    }

    func verify() async {
        guard let account = result?.payableAccount else { return }
        if account.institution.country != entry.country { await entry.choose(account.institution.country) }
        entry.institution = account.institution
        entry.number = account.number
        await entry.verify()
    }

    func scanAgain() {
        result = nil
        spotted = nil
        estimate = nil
    }

    private func settle(_ parsed: ScanResult) {
        spotted = nil
        estimate = nil
        result = parsed
        UINotificationFeedbackGenerator().notificationOccurred(parsed.payableAccount != nil ? .success : .warning)
        if parsed.payableAccount != nil { Task { await verify() } }
        if case .code(let code) = parsed { Task { await estimate(code) } }
    }

    private func estimate(_ code: ScannedCode) async {
        guard let amount = code.amount, let currency = code.currency.flatMap({ Currency(rawValue: $0.lowercased()) }),
              let rate = try? await api.rate(.usdc, currency), rate.rate > 0 else { return }
        estimate = amount / Decimal(rate.rate)
    }
}

extension ScanResult {
    /// What fliq can pay out today, if anything.
    var payableAccount: PayableAccount? {
        switch self {
        case .bank(let number, let institution, _): PayableAccount(number: number, institution: institution)
        case .code(let code): code.account
        default: nil
        }
    }
}

struct ScanToPayView: View {
    let model: ScanToPayModel
    let onPay: (VerifiedAccount) -> Void
    let onPerson: (String) -> Void
    let onTypeInstead: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var torch = false

    private var canScan: Bool { DataScannerViewController.isSupported && DataScannerViewController.isAvailable }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if canScan {
                CodeScanner(isScanning: model.isScanning, onCode: model.scanned(code:), onText: model.scanned(text:))
                    .ignoresSafeArea()
                viewfinder
            } else if model.result == nil {
                unavailable
            }
            if model.result != nil {
                Color.black.opacity(0.55).ignoresSafeArea().transition(.opacity)
            }
        }
        .overlay(alignment: .top) { topBar }
        .overlay(alignment: .bottom) { bottom }
        .animation(.snappy(duration: 0.25), value: model.result)
        .animation(.snappy(duration: 0.25), value: model.spotted)
        .task {
            await model.load()
            #if DEBUG
            if let sample = UserDefaults.standard.string(forKey: "ScanSample") { model.scanned(code: sample) }
            #endif
        }
        .onDisappear { setTorch(false) }
    }

    // MARK: Camera

    private var topBar: some View {
        HStack {
            Button { dismiss() } label: {
                Icon("xmark", size: 20).frame(width: 44, height: 44)
            }
            .fliqGlass(Circle(), interactive: true)
            .accessibilityLabel("Close")
            Spacer()
            if canScan {
                Button { setTorch(!torch) } label: {
                    Icon(torch ? "flashlight.on.fill" : "flashlight.off.fill", size: 20)
                        .frame(width: 44, height: 44)
                }
                .fliqGlass(Circle(), interactive: true)
                .accessibilityLabel(torch ? "Turn the torch off" : "Turn the torch on")
            }
        }
        .foregroundStyle(Theme.textPrimary)
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    private var viewfinder: some View {
        VStack(spacing: 22) {
            RoundedRectangle(cornerRadius: 32)
                .strokeBorder(Color.white.opacity(model.isScanning ? 0.9 : 0.3), lineWidth: 3)
                .frame(width: 270, height: 270)
                .accessibilityHidden(true)
            if model.isScanning {
                Text("Point at a bank QR code or an account number")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.textPrimary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .fliqGlass(Capsule())
            }
        }
        .padding(.bottom, 80)
    }

    private var unavailable: some View {
        VStack(spacing: 14) {
            Icon("qrcode.viewfinder", size: 46)
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 84, height: 84)
                .fliqGlass(Circle())
            Text("Scanning isn't available on this device")
                .font(.system(size: 20, weight: .semibold))
                .multilineTextAlignment(.center)
            Text("Type the account number and bank instead. It takes a few seconds.")
                .font(.system(size: 15))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
            Button("Type the account instead", action: onTypeInstead)
                .buttonStyle(PrimaryButtonStyle(filled: true))
                .padding(.top, 14)
        }
        .foregroundStyle(Theme.textPrimary)
        .padding(.horizontal, 28)
    }

    @ViewBuilder
    private var bottom: some View {
        if let result = model.result {
            ScanResultCard(
                result: result,
                model: model,
                onPay: onPay,
                onPerson: onPerson,
                onTypeInstead: onTypeInstead,
                onClose: { dismiss() }
            )
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        } else if let spotted = model.spotted {
            Button(action: model.useSpotted) {
                IconLabel("Use \(Self.masked(spotted))", icon: "number")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 22)
                    .frame(height: 52)
                    .background(.white, in: Capsule())
            }
            .padding(.bottom, 28)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    private func setTorch(_ on: Bool) {
        torch = on
        guard let device = AVCaptureDevice.default(for: .video), device.hasTorch, (try? device.lockForConfiguration()) != nil else { return }
        device.torchMode = on ? .on : .off
        device.unlockForConfiguration()
    }

    static func masked(_ number: String) -> String {
        "•••• " + number.suffix(4)
    }
}

// MARK: Result

private struct ScanResultCard: View {
    let result: ScanResult
    let model: ScanToPayModel
    let onPay: (VerifiedAccount) -> Void
    let onPerson: (String) -> Void
    let onTypeInstead: () -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            content
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 28))
        .overlay(RoundedRectangle(cornerRadius: 28).strokeBorder(Color.white.opacity(0.06)))
        .foregroundStyle(Theme.textPrimary)
    }

    @ViewBuilder
    private var content: some View {
        switch result {
        case .bank(let number, let institution, _):
            account(number: number, institution: institution)
        case .code(let code):
            details(code)
            if let payable = code.account {
                account(number: payable.number, institution: payable.institution)
            } else {
                IconLabel(code.comingSoon ?? "", icon: "clock")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                primary("Scan again", action: model.scanAgain)
                secondary("Close", action: onClose)
            }
        case .damaged:
            message("Couldn't read that code", detail: "Its checksum doesn't match. Hold steady and scan it again.")
            primary("Scan again", action: model.scanAgain)
            secondary("Close", action: onClose)
        case .numberOnly(let number):
            message(ScanToPayView.masked(number), detail: "Which bank is this account with?")
            bankPicker
            secondary("Scan again", action: model.scanAgain)
        case .choose(let numbers, _):
            message("Which account?", detail: "There's more than one account number in view.")
            ForEach(numbers, id: \.self) { number in
                Button { model.pick(number: number) } label: {
                    HStack {
                        Text(number).font(.system(size: 17, weight: .medium).monospacedDigit())
                        Spacer()
                        Icon("chevron.right", size: 18).foregroundStyle(Theme.textTertiary)
                    }
                    .padding(.horizontal, 16)
                    .frame(height: 52)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 14))
                }
            }
            secondary("Scan again", action: model.scanAgain)
        case .fliqName(let name):
            message("Pay \(FliqName.display(name))", detail: "A fliq user. They get it instantly, with no fee.")
            primary("Continue") { onPerson(name) }
            secondary("Scan again", action: model.scanAgain)
        case .nothing:
            message("Nothing to pay here", detail: "We couldn't find a bank account in that code.")
            primary("Type it instead", action: onTypeInstead)
            secondary("Scan again", action: model.scanAgain)
        }
    }

    /// Scheme and country, who is paid, where, and how much, with what it comes to in USDC.
    @ViewBuilder
    private func details(_ code: ScannedCode) -> some View {
        Text([code.flag, code.title].compactMap { $0 }.joined(separator: " "))
            .font(.system(size: 13, weight: .semibold))
            .tracking(0.6)
            .textCase(.uppercase)
            .foregroundStyle(Theme.textSecondary)
        VStack(alignment: .leading, spacing: 4) {
            Text(code.merchant ?? code.payee ?? "Payment code")
                .font(.system(size: 22, weight: .semibold))
                .lineLimit(2)
            if let city = code.city, !city.isEmpty {
                Text(city.localizedCapitalized).font(.system(size: 15)).foregroundStyle(Theme.textSecondary)
            }
            if let payee = code.payee, code.merchant != nil {
                Text(payee)
                    .font(.system(size: 14, design: .monospaced))
                    .foregroundStyle(Theme.textTertiary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        if let amount = code.amount {
            HStack(alignment: .firstTextBaseline) {
                Text(code.currency.map { amount.formatted(.currency(code: $0)) } ?? amount.formatted())
                    .font(.system(size: 28, weight: .medium).monospacedDigit())
                Spacer()
                if let estimate = model.estimate {
                    Text("≈ $" + estimate.formatted(.number.precision(.fractionLength(2))) + " USDC")
                        .font(.system(size: 15).monospacedDigit())
                        .foregroundStyle(Theme.textSecondary)
                }
            }
        }
    }

    @ViewBuilder
    private func account(number: String, institution: Institution) -> some View {
        let entry = model.entry
        HStack(spacing: 14) {
            InstitutionLogo(logoKey: institution.logoKey, name: institution.name, size: 48)
            VStack(alignment: .leading, spacing: 3) {
                Text(institution.name).font(.system(size: 18, weight: .semibold))
                Text(ScanToPayView.masked(number))
                    .font(.system(size: 15).monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer()
        }
        Group {
            if let verified = entry.verified {
                IconLabel(verified.accountName.localizedCapitalized, icon: "checkmark.circle.fill")
                    .foregroundStyle(Theme.confirmed)
            } else if let error = entry.errorMessage {
                IconLabel(error, icon: "exclamationmark.circle").foregroundStyle(Theme.warning)
            } else {
                HStack(spacing: 10) {
                    ProgressView().controlSize(.small)
                    Text("Checking with \(institution.name)").foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .font(.system(size: 16, weight: .medium))
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 14))

        if let verified = entry.verified {
            primary("Continue") { onPay(verified) }
            secondary("Scan again", action: model.scanAgain)
        } else if entry.errorMessage != nil {
            primary("Try again") { Task { await model.verify() } }
            secondary("Type it instead", action: onTypeInstead)
        } else {
            secondary("Scan again", action: model.scanAgain)
        }
    }

    private var bankPicker: some View {
        Menu {
            ForEach(model.institutions, id: \.code) { institution in
                Button(institution.name) { model.pick(institution: institution) }
            }
        } label: {
            HStack {
                Icon("building.columns")
                Text("Choose the bank")
                Spacer()
                Icon("chevron.up.chevron.down", size: 18).foregroundStyle(Theme.textTertiary)
            }
            .font(.system(size: 17, weight: .medium))
            .foregroundStyle(Theme.textPrimary)
            .padding(.horizontal, 16)
            .frame(height: 52)
            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 14))
        }
    }

    private func message(_ title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 20, weight: .semibold))
            Text(detail).font(.system(size: 15)).foregroundStyle(Theme.textSecondary)
        }
    }

    private func primary(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action).buttonStyle(PrimaryButtonStyle(filled: true))
    }

    private func secondary(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity)
    }
}

// MARK: Camera

private struct CodeScanner: UIViewControllerRepresentable {
    let isScanning: Bool
    let onCode: (String) -> Void
    let onText: ([String]) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr]), .text()],
            qualityLevel: .balanced,
            recognizesMultipleItems: true,
            isHighFrameRateTrackingEnabled: false,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: false,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        context.coordinator.parent = self
        if isScanning, !scanner.isScanning { try? scanner.startScanning() }
        if !isScanning, scanner.isScanning { scanner.stopScanning() }
    }

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    @MainActor
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        var parent: CodeScanner

        init(parent: CodeScanner) {
            self.parent = parent
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            report(allItems)
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didUpdate updatedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            report(allItems)
        }

        private func report(_ items: [RecognizedItem]) {
            var lines: [String] = []
            for item in items {
                switch item {
                case .barcode(let code):
                    if let payload = code.payloadStringValue { return parent.onCode(payload) }
                case .text(let text):
                    lines.append(text.transcript)
                @unknown default:
                    break
                }
            }
            if !lines.isEmpty { parent.onText(lines) }
        }
    }
}
