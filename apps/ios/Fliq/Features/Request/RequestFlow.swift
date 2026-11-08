import Foundation
import Observation

/// Request: type dollars and a note, get a link anyone can pay from any chain, then watch for the payment.
@MainActor
@Observable
final class RequestFlow {
    static let pollInterval: Duration = .seconds(4)

    private(set) var amountText = ""
    var note = ""
    var cashOutOnArrival = false
    private(set) var request: PaymentRequest?
    private(set) var isCreating = false
    private(set) var errorMessage: String?

    private let api: any FliqAPI
    private let vault: VaultStore?
    private let idempotencyKey = UUID().uuidString

    init(api: any FliqAPI, vault: VaultStore? = nil) {
        self.api = api
        self.vault = vault
    }

    var amount: TokenAmount? { TokenAmount(decimalString: amountText) }
    var canCreate: Bool { (amount ?? .zero) > .zero && !isCreating && request == nil }

    func tapKey(_ key: String) {
        amountText = AmountTyping.apply(key, to: amountText)
    }

    func create() async {
        guard canCreate, let amount else { return }
        isCreating = true
        defer { isCreating = false }
        do {
            let input = PaymentRequestInput(amount: amount.decimalString, note: note.trimmingCharacters(in: .whitespacesAndNewlines), cashOutOnArrival: cashOutOnArrival)
            request = try await api.createRequest(input, idempotencyKey: idempotencyKey)
            errorMessage = nil
        } catch {
            errorMessage = "The link didn't get made. Try again in a moment."
        }
    }

    /// Polls until the request is paid or cancelled, then credits the vault once.
    func watch() async {
        while let current = request, current.state == .open, !Task.isCancelled {
            try? await Task.sleep(for: Self.pollInterval)
            guard let next = try? await api.request(id: current.requestId) else { continue }
            request = next
            if next.state == .paid, let landed = next.paid.flatMap({ TokenAmount(decimalString: $0.landed) }) {
                vault?.credit(landed)
            }
        }
    }
}
