import Foundation
import Observation

@MainActor
@Observable
final class OnboardingFlow {
    enum NameStatus: Equatable {
        case empty, invalid, checking, available, taken, unreachable
    }

    static let checkDelay: Duration = .milliseconds(300)

    var nameText = "" {
        didSet { if nameText != oldValue { scheduleCheck() } }
    }
    private(set) var status = NameStatus.empty
    private(set) var suggestions: [String] = []

    var displayName = ""
    var bio = ""
    var photo: Data?

    let ownAccount: AccountEntry

    /// The name the API recorded for this user. Fixtures never record one.
    private(set) var claimed: String?

    private let api: any FliqAPI
    private let isLive: Bool
    private let names: any NameDirectory
    private var check: Task<Void, Never>?

    init(api: any FliqAPI, names: any NameDirectory, isLive: Bool = false) {
        self.api = api
        self.isLive = isLive
        self.names = names
        ownAccount = AccountEntry(api: api)
    }

    var name: FliqName? { FliqName(nameText) }
    var canClaim: Bool { status == .available && name != nil }

    /// Claims the name on the server before moving on, so a name taken in the meantime shows here.
    func claim() async -> Bool {
        guard canClaim, let name else { return false }
        guard isLive else { return true }
        do {
            claimed = try await api.claimName(name).nearAccount
            return true
        } catch {
            status = .taken
            suggestions = await freeAlternatives(to: name)
            return false
        }
    }

    func saveProfile() async {
        guard isLive, !displayName.isEmpty else { return }
        _ = try? await api.updateProfile(displayName: displayName)
    }

    func pick(_ suggestion: String) {
        nameText = suggestion
    }

    private func scheduleCheck() {
        check?.cancel()
        suggestions = []
        guard !nameText.isEmpty else { status = .empty; return }
        guard let name else { status = .invalid; return }
        status = .checking
        check = Task { [weak self] in
            try? await Task.sleep(for: Self.checkDelay)
            guard !Task.isCancelled else { return }
            await self?.resolve(name)
        }
    }

    /// Runs the availability check now. The view debounces through `nameText`; tests call this.
    func resolve(_ name: FliqName) async {
        do {
            let free = try await names.isAvailable(name)
            guard self.name == name else { return }
            status = free ? .available : .taken
            if !free { suggestions = await freeAlternatives(to: name) }
        } catch {
            if self.name == name { status = .unreachable }
        }
    }

    private func freeAlternatives(to name: FliqName) async -> [String] {
        let first = displayName.split(separator: " ").first.map { $0.lowercased() } ?? ""
        let candidates = [
            "\(name.value)-\(first.prefix(1))",
            "\(name.value)\(Calendar.current.component(.year, from: .now) % 100)",
            "\(name.value)-pay",
            "hey-\(name.value)",
        ]
        let options = candidates.compactMap(FliqName.init).filter { $0 != name }
        let names = names
        let free = await withTaskGroup(of: (Int, Bool).self) { group in
            for (index, option) in options.enumerated() {
                group.addTask { (index, (try? await names.isAvailable(option)) == true) }
            }
            var results: [(Int, Bool)] = []
            for await result in group { results.append(result) }
            return results.filter(\.1).map(\.0).sorted()
        }
        return free.prefix(3).map { options[$0].value }
    }
}
