import SwiftUI

struct NotificationsView: View {
    @Environment(AppEnvironment.self) private var environment

    private let groups: [(String, [Preferences.Notice])] = [
        ("Money", [.received, .payoutPaid, .payoutRefunded]),
        ("Agents", [.agentPaid, .agentRefused, .capAlmostReached]),
        ("Rates", [.rateAlert, .weeklySummary]),
    ]

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                ForEach(groups, id: \.0) { title, notices in
                    SectionLabel(text: title).padding(.top, 20)
                    VStack(spacing: 0) {
                        ForEach(notices, id: \.self) { notice in
                            CardRow(isLast: notice == notices.last) {
                                Toggle(isOn: binding(notice)) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(notice.title)
                                        if let detail = notice.detail {
                                            Text(detail).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                                        }
                                    }
                                }
                                .tint(Theme.confirmed)
                            }
                        }
                    }
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
                    .foregroundStyle(Theme.textPrimary)
                }
                Text("Your choices are saved now. Alerts start arriving once fliq sends push notifications.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
                    .padding(.top, 12)
            }
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .fliqScreen("Notifications")
    }

    private func binding(_ notice: Preferences.Notice) -> Binding<Bool> {
        Binding(get: { environment.preferences.isOn(notice) }, set: { environment.preferences.set(notice, $0) })
    }
}
