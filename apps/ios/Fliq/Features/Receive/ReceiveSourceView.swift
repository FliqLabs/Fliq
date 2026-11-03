import SwiftUI

struct ReceiveSourceView: View {
    let flow: ReceiveFlow
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(DepositSource.Group.allCases, id: \.self) { group in
                    let sources = flow.sources.filter { $0.group == group }
                    if !sources.isEmpty {
                        Text(group.rawValue)
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.top, 10)
                            .padding(.horizontal, 2)
                        ForEach(sources) { source in
                            Button { pick(source) } label: { SourceRow(source: source) }
                        }
                    }
                }
            }
            .padding(.top, 8)
        }
        .scrollIndicators(.hidden)
        .fliqScreen("Receive from")
        .task { await flow.loadSources() }
    }

    private func pick(_ source: DepositSource) {
        flow.source = source
        if source.isDirect {
            Task { if await flow.reserve() { environment.router.push(.receiveAddress) } }
        } else {
            environment.router.push(.receiveAmount)
        }
    }
}

struct SourceBadge: View {
    let source: DepositSource
    var size: CGFloat = 38

    var body: some View {
        Text(String(source.token.prefix(1)))
            .font(.system(size: size * 0.42, weight: .semibold))
            .frame(width: size, height: size)
            .background(Theme.surfaceRaised, in: Circle())
            .overlay(alignment: .bottomTrailing) {
                Text(String(source.chain.prefix(1)))
                    .font(.system(size: size * 0.24, weight: .bold))
                    .frame(width: size * 0.46, height: size * 0.46)
                    .background(Color(hex: 0x111111), in: Circle())
                    .overlay(Circle().strokeBorder(Color(hex: 0x1E1E1E), lineWidth: 2))
                    .offset(x: 3, y: 3)
            }
            .accessibilityHidden(true)
    }
}

private struct SourceRow: View {
    let source: DepositSource

    var body: some View {
        HStack(spacing: 14) {
            SourceBadge(source: source)
            VStack(alignment: .leading, spacing: 3) {
                Text(source.token).font(.system(size: 16, weight: .medium))
                Text(subtitle).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.textTertiary)
        }
        .padding(.horizontal, 16)
        .frame(height: 62)
        .background(Color(hex: 0x1E1E1E), in: RoundedRectangle(cornerRadius: 14))
        .foregroundStyle(Theme.textPrimary)
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        var parts = [source.chain]
        if let minimum = source.minimum { parts.append("min $\(Money.dollars(minimum))") }
        if let note = source.note { parts = [note] }
        return parts.joined(separator: " · ")
    }
}
