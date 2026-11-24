import Foundation
import Observation

/// Which notifications the owner wants. Kept on the device so the screen is right at launch, and on the server, which
/// is what actually sends them. Nothing here is secret.
@MainActor
@Observable
final class Preferences {
    enum Notice: String, CaseIterable, Sendable {
        case received, payoutPaid, payoutRefunded, agentPaid, agentRefused, capAlmostReached, rateAlert, weeklySummary

        var title: String {
            switch self {
            case .received: "Received in your vault"
            case .payoutPaid: "Payout paid"
            case .payoutRefunded: "Payout refunded"
            case .agentPaid: "An agent paid"
            case .agentRefused: "An agent was refused"
            case .capAlmostReached: "Daily cap almost reached"
            case .rateAlert: "Rate alert"
            case .weeklySummary: "Weekly summary"
            }
        }

        var detail: String? {
            switch self {
            case .capAlmostReached: "At 80%"
            default: nil
            }
        }

        var onByDefault: Bool { self != .rateAlert && self != .weeklySummary }
    }

    private enum Key {
        static let notices = "prefs.notices"
        static let rateAbove = "prefs.rateAbove"
        static let rateCurrency = "prefs.rateCurrency"
        static let uploaded = "prefs.uploaded"
        /// A change made here has not reached the server yet, for example because the phone was offline.
        static let pending = "prefs.pending"
    }

    private(set) var notices: Set<Notice>
    /// The rate alert fires when $1 pays more than this, in `rateCurrency`. Nil until the owner picks one.
    private(set) var rateAbove: Double?
    private(set) var rateCurrency: Currency

    private let defaults: UserDefaults
    @ObservationIgnored private var api: (any FliqAPI)?
    @ObservationIgnored private var lastUpload: Task<Void, Never>?
    @ObservationIgnored private var changes = 0

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let stored = defaults.stringArray(forKey: Key.notices)
        notices = stored.map { Set($0.compactMap(Notice.init)) } ?? Set(Notice.allCases.filter(\.onByDefault))
        rateAbove = defaults.object(forKey: Key.rateAbove) as? Double
        rateCurrency = defaults.string(forKey: Key.rateCurrency).flatMap(Currency.init)
            ?? (DisplayCurrency.stored(in: defaults) == .kes ? .kes : .ngn)
    }

    /// From here on every change is also saved on the server.
    func connect(_ api: any FliqAPI) {
        self.api = api
    }

    /// The server's copy wins, so choices made before a reinstall come back. The one exception is the first sync on
    /// an account the server has never had choices for: then this iPhone's choices, kept only here until now, go up.
    func sync() async {
        guard let api else { return }
        await lastUpload?.value
        if defaults.bool(forKey: Key.pending) {
            // A change that never got through is sent again, not replaced by the server's older copy.
            upload()
            await lastUpload?.value
            return
        }
        let before = changes
        guard let server = try? await api.notificationSettings() else { return }
        // A change made while the server was being read is newer than what it returned.
        guard changes == before else { return }
        if !defaults.bool(forKey: Key.uploaded), server == Self.newUser, settings != server {
            guard (try? await api.updateNotificationSettings(settings)) != nil else { return }
        } else {
            apply(server)
        }
        defaults.set(true, forKey: Key.uploaded)
    }

    /// What the server holds for someone who never chose: money and agent notices on, rates off.
    static let newUser = NotificationSettings(
        received: true, payoutPaid: true, payoutRefunded: true, agentPaid: true, agentRefused: true, capAlmostReached: true,
        rateAlert: .init(enabled: false, currency: "NGN", above: nil), weeklySummary: false
    )

    func isOn(_ notice: Notice) -> Bool { notices.contains(notice) }

    func set(_ notice: Notice, _ on: Bool) {
        if on { notices.insert(notice) } else { notices.remove(notice) }
        persist()
        upload()
    }

    func setRate(above: Double, in currency: Currency) {
        guard above > 0 else { return }
        rateAbove = above
        rateCurrency = currency
        persist()
        upload()
    }

    /// "When $1 beats ₦1,450", or nil before a rate is picked.
    var rateDetail: String? {
        rateAbove.map { "When $1 beats \(rateCurrency.symbol)\(Self.whole($0))" }
    }

    static func whole(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0)))
    }

    /// What the server keeps. The alert only counts as on once it has a rate, because the server refuses one without.
    var settings: NotificationSettings {
        NotificationSettings(
            received: isOn(.received), payoutPaid: isOn(.payoutPaid), payoutRefunded: isOn(.payoutRefunded),
            agentPaid: isOn(.agentPaid), agentRefused: isOn(.agentRefused), capAlmostReached: isOn(.capAlmostReached),
            rateAlert: .init(enabled: isOn(.rateAlert) && rateAbove != nil, currency: rateCurrency.rawValue.uppercased(), above: rateAbove),
            weeklySummary: isOn(.weeklySummary)
        )
    }

    private func apply(_ settings: NotificationSettings) {
        let on: [Notice: Bool] = [
            .received: settings.received, .payoutPaid: settings.payoutPaid, .payoutRefunded: settings.payoutRefunded,
            .agentPaid: settings.agentPaid, .agentRefused: settings.agentRefused, .capAlmostReached: settings.capAlmostReached,
            .rateAlert: settings.rateAlert.enabled, .weeklySummary: settings.weeklySummary,
        ]
        notices = Set(on.filter(\.value).keys)
        if let above = settings.rateAlert.above { rateAbove = above }
        if let currency = Currency(rawValue: settings.rateAlert.currency.lowercased()) { rateCurrency = currency }
        persist()
    }

    private func persist() {
        defaults.set(notices.map(\.rawValue).sorted(), forKey: Key.notices)
        defaults.set(rateAbove, forKey: Key.rateAbove)
        defaults.set(rateCurrency.rawValue, forKey: Key.rateCurrency)
    }

    // One save at a time, in order, so a quick on then off never lands on the server as on.
    private func upload() {
        guard let api else { return }
        let snapshot = settings
        let previous = lastUpload
        changes += 1
        defaults.set(true, forKey: Key.pending)
        lastUpload = Task {
            await previous?.value
            let saved = (try? await api.updateNotificationSettings(snapshot)) != nil
            if saved, snapshot == settings { defaults.set(false, forKey: Key.pending) }
        }
    }

    /// Waits for every save started so far. For tests.
    func uploaded() async { await lastUpload?.value }
}

/// The currency Home shows the balance in. A bank payout starts typing in the bank's currency unless this is dollars.
/// Kept on this iPhone; dollars until the owner picks another.
enum DisplayCurrency: String, CaseIterable, Identifiable, Sendable {
    case usd, ngn, kes

    static let storageKey = "display.currency"

    static func stored(in defaults: UserDefaults = .standard) -> DisplayCurrency {
        defaults.string(forKey: storageKey).flatMap(Self.init) ?? .usd
    }

    var id: String { rawValue }

    /// Nil for dollars, which need no rate.
    var local: Currency? {
        switch self {
        case .usd: nil
        case .ngn: .ngn
        case .kes: .kes
        }
    }

    var symbol: String { local?.symbol ?? "$" }

    var name: String {
        switch self {
        case .usd: "US dollar"
        case .ngn: "Naira"
        case .kes: "Kenyan shilling"
        }
    }
}
