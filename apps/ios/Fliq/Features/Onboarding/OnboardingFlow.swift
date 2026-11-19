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
    private(set) var isClaiming = false

    var displayName = ""
    var bio = ""
    var photo: Data?

    let ownAccount: AccountEntry

    /// The name the API recorded for this user. Fixtures never record one.
    private(set) var claimed: String?
    /// The NEAR key the passkey made at sign-up, when it could. The account starts with it, so any browser or iPhone
    /// with this passkey can later add itself. This iPhone's own key is added right after, signed by it.
    var passkeyKey: (any DeviceKeys)?
    /// Adding this iPhone's key after the account is made. Tests wait on it.
    private(set) var addingThisIPhone: Task<Void, Never>?
    static let addRetries = 8
    var addRetryDelay: Duration = .seconds(1.5)

    private let api: any FliqAPI
    private let isLive: Bool
    private let names: any NameDirectory
    private let keys: any DeviceKeys
    private let photos: (any PhotoUploads)?
    private let recovery: (any AccountRecovering)?
    private var check: Task<Void, Never>?

    init(
        api: any FliqAPI,
        names: any NameDirectory,
        isLive: Bool = false,
        keys: any DeviceKeys = KeychainDeviceKeys(),
        photos: (any PhotoUploads)? = nil,
        recovery: (any AccountRecovering)? = nil
    ) {
        self.photos = photos
        self.recovery = recovery
        self.api = api
        self.isLive = isLive
        self.names = names
        self.keys = keys
        ownAccount = AccountEntry(api: api)
    }

    var name: FliqName? { FliqName(nameText) }
    var canClaim: Bool { status == .available && name != nil && !isClaiming }

    /// Claims the name on the server before moving on, so a name taken in the meantime shows here.
    func claim() async -> Bool {
        guard canClaim, let name else { return false }
        guard isLive else { return true }
        isClaiming = true
        defer { isClaiming = false }
        guard let publicKey = try? keys.publicKey() else {
            status = .unreachable
            return false
        }
        let passkey = recovery == nil ? nil : passkeyKey
        let startKey = (try? passkey?.publicKey()) ?? publicKey
        do {
            claimed = try await api.claimName(name, publicKey: startKey).nearAccount
            if let passkey, startKey != publicKey, let claimed { addThisIPhone(to: claimed, with: passkey) }
            return true
        } catch APIError.server(status: 409, _) {
            status = .taken
            suggestions = await freeAlternatives(to: name)
            return false
        } catch {
            status = .unreachable
            return false
        }
    }

    /// The account was just made, so the chain can take a moment to show it. If every try fails, the app's restore
    /// sheet offers the same step with the passkey at the next launch, so nothing is lost.
    private func addThisIPhone(to account: String, with passkey: any DeviceKeys) {
        guard let recovery else { return }
        let delay = addRetryDelay
        addingThisIPhone = Task {
            for attempt in 0..<Self.addRetries {
                do {
                    try await recovery.addThisIPhone(to: account, with: passkey)
                    return
                } catch {
                    if attempt + 1 < Self.addRetries { try? await Task.sleep(for: delay) }
                }
            }
        }
    }

    func saveProfile() async {
        guard isLive else { return }
        if !displayName.isEmpty { _ = try? await api.updateProfile(displayName: displayName) }
        guard let photo, let photos, let jpeg = ProfilePhoto.prepare(photo), let url = try? await photos.upload(jpeg) else { return }
        _ = try? await api.updateProfilePhoto(url)
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
            guard !Task.isCancelled, self.name == name else { return }
            status = free ? .available : .taken
            if !free { suggestions = await freeAlternatives(to: name) }
        } catch {
            // A newer keystroke cancelled this check; its own check will answer, even for the same name.
            guard !Task.isCancelled, self.name == name else { return }
            status = .unreachable
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
