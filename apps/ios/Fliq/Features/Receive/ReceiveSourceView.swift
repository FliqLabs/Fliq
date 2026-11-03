import SwiftUI

struct ReceiveSourceView: View {
    let flow: ReceiveFlow
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        VStack(spacing: 0) {
            Wordmark(size: 24)
                .opacity(0.25)
                .padding(.top, 25)
            Spacer(minLength: 0)
            sheet
        }
        .background(Color(hex: 0x050505).ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task { await flow.loadSources() }
    }

    private var sheet: some View {
        VStack(alignment: .leading, spacing: 8) {
            Capsule()
                .fill(Color(hex: 0x3A3A3A))
                .frame(width: 36, height: 4)
                .frame(maxWidth: .infinity)
                .padding(.bottom, 8)
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(groups.enumerated()), id: \.element) { index, group in
                        Text(group.rawValue)
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.horizontal, 2)
                            .padding(.top, index == 0 ? 8 : 10)
                        ForEach(flow.sources.filter { $0.group == group }) { source in
                            Button { pick(source) } label: { SourceRow(source: source) }
                                .buttonStyle(.pressable)
                        }
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .frame(maxWidth: .infinity, alignment: .top)
        .frame(height: 666)
        .background(
            UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24)
                .fill(Color(hex: 0x141414))
                .ignoresSafeArea(edges: .bottom)
        )
    }

    private var header: some View {
        HStack {
            Button { environment.router.reset() } label: {
                Image(systemName: "chevron.left").font(.system(size: 18, weight: .medium))
                    .frame(width: 32, height: 32, alignment: .leading)
            }
            .accessibilityLabel("Back")
            Spacer()
            Text("Receive from").font(.system(size: 17, weight: .semibold))
            Spacer()
            Button { environment.router.reset() } label: {
                Image(systemName: "xmark").font(.system(size: 17, weight: .medium))
                    .frame(width: 32, height: 32, alignment: .trailing)
            }
            .accessibilityLabel("Close")
        }
        .foregroundStyle(Theme.textPrimary)
        .frame(height: 32)
    }

    private var groups: [DepositSource.Group] {
        DepositSource.Group.allCases.filter { group in flow.sources.contains { $0.group == group } }
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

/// The token's coin with its chain in a small ring at the bottom right, as on every Receive screen.
struct SourceBadge: View {
    let source: DepositSource
    var size: CGFloat = 38
    var ring = Color(hex: 0x1E1E1E)

    var body: some View {
        Image("Token\(source.token)")
            .resizable()
            .scaledToFill()
            .frame(width: size, height: size)
            .clipShape(Circle())
            .overlay(alignment: .bottomTrailing) {
                if source.group != .bitcoin {
                    Image("Chain\(source.chain)")
                        .resizable()
                        .scaledToFit()
                        .frame(width: chainSize, height: chainSize)
                        .background(Color(hex: 0x111111))
                        .clipShape(Circle())
                        .padding(2)
                        .background(ring, in: Circle())
                        .offset(x: 3, y: 3)
                }
            }
            .accessibilityHidden(true)
    }

    private var chainSize: CGFloat { (size * 0.47).rounded() }
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
                .foregroundStyle(Theme.textMuted)
        }
        .padding(.horizontal, 16)
        .frame(height: 62)
        .background(Color(hex: 0x1E1E1E), in: RoundedRectangle(cornerRadius: 14))
        .foregroundStyle(Theme.textPrimary)
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        if let note = source.note { return note }
        guard let minimum = source.minimum else { return source.chain }
        return "\(source.chain) · min $\(Money.dollars(minimum))"
    }
}
