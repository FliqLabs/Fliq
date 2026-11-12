import SwiftUI

/// Tapping any Activity or Recent row: the mark, who, how much and when, a timeline of what happened, then the facts.
struct ActivityDetailSheet: View {
    let line: ActivityLine
    var onReceipt: ((String) -> Void)?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                ActivityBadgeView(badge: line.badge, size: 64, moving: line.outcome == .moving)
                    .padding(.top, 8)
                Text(line.title)
                    .font(.system(size: 20, weight: .medium))
                    .multilineTextAlignment(.center)
                    .padding(.top, 14)
                Text(line.amount)
                    .font(.system(size: 44, weight: .semibold))
                    .tracking(-1)
                    .monospacedDigit()
                    .strikethrough(line.outcome == .refused, color: Theme.textTertiary)
                    .foregroundStyle(line.outcome == .refused ? Theme.textTertiary : Theme.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .padding(.top, 4)
                Text(ActivityLine.time(line.date))
                    .font(.system(size: 16))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.top, 2)

                timeline.padding(.top, 24)

                VStack(spacing: 0) {
                    ForEach(Array(line.facts.filter { !$0.1.isEmpty }.enumerated()), id: \.offset) { _, fact in
                        HStack(alignment: .firstTextBaseline) {
                            Text(fact.0).foregroundStyle(Theme.textSecondary)
                            Spacer(minLength: 16)
                            Text(fact.1)
                                .foregroundStyle(fact.0 == "Status" ? line.statusColor : Theme.textPrimary)
                                .monospacedDigit()
                                .lineLimit(1)
                                .truncationMode(.middle)
                                .textSelection(.enabled)
                        }
                        .font(.system(size: 16))
                        .padding(.vertical, 12)
                    }
                    HStack {
                        Text("Category").foregroundStyle(Theme.textSecondary)
                        Spacer()
                        Text(line.category)
                    }
                    .font(.system(size: 16))
                    .padding(.vertical, 12)
                    .overlay(alignment: .top) { Rectangle().fill(Theme.hairline).frame(height: 1) }
                }
                .padding(.horizontal, 4)
                .padding(.top, 20)

                if let payoutId = line.payoutId, let onReceipt {
                    Button("Open receipt") {
                        dismiss()
                        onReceipt(payoutId)
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.top, 20)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .scrollIndicators(.hidden)
        .safeAreaInset(edge: .top) {
            HStack {
                Spacer()
                Button { dismiss() } label: {
                    Icon("xmark", size: 18)
                        .foregroundStyle(Theme.textPrimary)
                        .frame(width: 44, height: 44)
                        .fliqGlass(Circle(), interactive: true)
                }
                .accessibilityLabel("Close")
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
        }
    }

    private var timeline: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(header).font(.system(size: 16)).foregroundStyle(Theme.textSecondary)
                Spacer()
                headerMark
            }
            .padding(.bottom, 18)
            ForEach(Array(line.steps.enumerated()), id: \.offset) { index, step in
                HStack(alignment: .top, spacing: 16) {
                    VStack(spacing: 4) {
                        Circle()
                            .fill(step.done ? Theme.confirmed : line.outcome == .moving ? Theme.textTertiary : Theme.warning)
                            .frame(width: 8, height: 8)
                            .padding(.top, 7)
                        if index < line.steps.count - 1 {
                            Rectangle().fill(step.done ? Theme.confirmed : Theme.hairline).frame(width: 2, height: 36)
                        }
                    }
                    .frame(width: 10)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(step.title).font(.system(size: 17, weight: .medium))
                        Text(step.detail).font(.system(size: 15)).foregroundStyle(Theme.textSecondary)
                    }
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
    }

    private var header: String {
        switch line.outcome {
        case .done: line.category == "Deposit" ? "Deposit completed" : line.category == "Cash out" ? "Cash out completed" : "Transfer completed"
        case .moving: "In progress"
        case .refunded: "Refunded to your vault"
        case .refused: "Refused by your vault"
        case .failed: "Didn't go through"
        }
    }

    @ViewBuilder
    private var headerMark: some View {
        switch line.outcome {
        case .done: Icon("checkmark.circle.fill", size: 22).foregroundStyle(Theme.confirmed)
        case .moving: ProgressView().controlSize(.small)
        case .refunded: Icon("arrow.counterclockwise", size: 20).foregroundStyle(Theme.textSecondary)
        case .refused, .failed: Icon("exclamationmark.circle", size: 22).foregroundStyle(Theme.warning)
        }
    }
}
